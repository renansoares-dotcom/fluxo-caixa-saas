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

-- Somente usuários autenticados executam as funções
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
revoke execute on function public.aplicar_plano_modelo(uuid) from authenticated;

-- Funções de gatilho não devem ser chamáveis pela API
revoke execute on function public.tg_autorizacao_numero(), public.tg_lanc_mesma_empresa(), public.tg_updated_at() from authenticated, anon, public;

-- Prazo cobrado pelo fundo (base da "taxa do fundo"); prazo_medio continua sendo o prazo real
alter table public.fidc_operacoes add column if not exists prazo_cobrado numeric(10,2);
comment on column public.fidc_operacoes.prazo_medio is 'Prazo médio real dos títulos (dias), ponderado pelo valor';
comment on column public.fidc_operacoes.prazo_cobrado is 'Prazo médio cobrado pelo fundo no borderô (dias); base da taxa do fundo. Nulo = igual ao prazo real';

-- Índices de referência por mês (CDI a.m. em %), usados na Análise FIDC
create table if not exists public.indices_mensais (
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  ano int not null,
  mes smallint not null check (mes between 1 and 12),
  cdi numeric(8,4),            -- CDI do mês, em % a.m. (ex.: 1.0800 = 1,08%)
  updated_at timestamptz not null default now(),
  primary key (empresa_id, ano, mes)
);
comment on table public.indices_mensais is 'Índices de referência por mês (CDI a.m. em %), usados na Análise FIDC';
alter table public.indices_mensais enable row level security;
create policy indices_mensais_sel on public.indices_mensais for select to authenticated using (public.is_membro(empresa_id));
create policy indices_mensais_ins on public.indices_mensais for insert to authenticated with check (public.pode_editar(empresa_id));
create policy indices_mensais_upd on public.indices_mensais for update to authenticated using (public.pode_editar(empresa_id)) with check (public.pode_editar(empresa_id));
create policy indices_mensais_del on public.indices_mensais for delete to authenticated using (public.pode_editar(empresa_id));
revoke all on public.indices_mensais from anon;
grant select, insert, update, delete on public.indices_mensais to authenticated;

-- Propostas de borderô FIDC montadas na plataforma (títulos escolhidos + fundo), aprovadas pelo diretor.
-- O borderô original do fundo (fidc_operacoes) entra depois apenas para comparação.

-- Condições de cada fundo (usadas na simulação)
create table if not exists public.fidc_fundos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  nome text not null,                         -- igual ao campo fundo de fidc_operacoes (FS, Negocial, Contato, Vector)
  conta_id uuid references public.contas(id) on delete set null,          -- conta do fundo no fluxo de caixa
  conta_credito_id uuid references public.contas(id) on delete set null,  -- conta onde o líquido é creditado
  taxa_am numeric(8,4) not null default 0,    -- % a.m. (deságio), mesma convenção da taxa do fundo
  ad_valorem_pct numeric(8,4) not null default 0,   -- % sobre a face
  tarifa_operacao numeric(12,2) not null default 0, -- R$ por borderô
  tarifa_titulo numeric(12,2) not null default 0,   -- R$ por título
  iof_pct numeric(8,4) not null default 0,          -- % sobre a face (estimativa)
  dias_compensacao int not null default 0,          -- dias somados ao prazo cobrado
  prazo_min int, prazo_max int,
  limite_credito numeric(16,2),                     -- limite total de carteira cedida a vencer
  limite_sacado_pct numeric(6,2),                   -- % máximo de um sacado no fundo
  ativo boolean not null default true,
  observacao text,
  updated_at timestamptz not null default now(),
  unique (empresa_id, nome)
);

create table if not exists public.fidc_propostas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  numero int not null,
  fundo_id uuid not null references public.fidc_fundos(id),
  data_operacao date not null default current_date,
  status text not null default 'Rascunho' check (status in ('Rascunho','Pendente','Aprovada','Rejeitada','Cancelada')),
  qtd_titulos int not null default 0,
  valor_face numeric(16,2) not null default 0,
  prazo_medio numeric(10,2) not null default 0,
  prazo_cobrado numeric(10,2) not null default 0,
  taxa_am numeric(8,4) not null default 0,
  desagio numeric(16,2) not null default 0,
  ad_valorem numeric(16,2) not null default 0,
  tarifas numeric(16,2) not null default 0,
  iof numeric(16,2) not null default 0,
  custo_total numeric(16,2) generated always as (desagio + ad_valorem + tarifas + iof) stored,
  recompras numeric(16,2) not null default 0,       -- recompras/abatimentos que o fundo vai descontar (informado)
  liquido numeric(16,2) not null default 0,
  conta_credito_id uuid references public.contas(id) on delete set null,
  analise jsonb,                                    -- fotografia das análises no momento do envio
  observacao text,
  motivo text,                                      -- motivo da rejeição/cancelamento
  criado_por uuid default auth.uid(),
  criado_em timestamptz not null default now(),
  enviado_em timestamptz,
  aprovado_por uuid references auth.users(id),
  aprovado_em timestamptz,
  operacao_id uuid references public.fidc_operacoes(id) on delete set null,  -- borderô original vinculado
  comparativo jsonb,
  unique (empresa_id, numero)
);
create index if not exists fidc_propostas_emp on public.fidc_propostas(empresa_id, status);
create index if not exists fidc_propostas_fundo on public.fidc_propostas(fundo_id);
create index if not exists fidc_propostas_op on public.fidc_propostas(operacao_id);

create table if not exists public.fidc_proposta_itens (
  id uuid primary key default gen_random_uuid(),
  proposta_id uuid not null references public.fidc_propostas(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  lancamento_id uuid references public.lancamentos(id) on delete set null,
  documento text, sacado text, cnpj text,
  emissao date, vencimento date not null,
  valor numeric(16,2) not null,
  prazo int,
  custo_estimado numeric(16,2),
  situacao_bordero text                              -- após comparar: aceito / recusado / valor divergente
);
create index if not exists fidc_proposta_itens_p on public.fidc_proposta_itens(proposta_id);
create index if not exists fidc_proposta_itens_l on public.fidc_proposta_itens(lancamento_id);
create index if not exists fidc_proposta_itens_e on public.fidc_proposta_itens(empresa_id);

-- Títulos (NF/parcela) nos lançamentos
alter table public.lancamentos add column if not exists documento text;
alter table public.lancamentos add column if not exists emissao date;
alter table public.lancamentos add column if not exists fidc_proposta_id uuid references public.fidc_propostas(id) on delete set null;
create index if not exists lancamentos_doc on public.lancamentos(empresa_id, documento);
create index if not exists lancamentos_prop on public.lancamentos(fidc_proposta_id);

-- Número sequencial por empresa
create or replace function public.tg_fidc_proposta_numero() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.numero is null or new.numero = 0 then
    select coalesce(max(numero),0) + 1 into new.numero from fidc_propostas where empresa_id = new.empresa_id;
  end if;
  return new;
end $$;
create trigger fidc_propostas_numero before insert on public.fidc_propostas
  for each row execute function public.tg_fidc_proposta_numero();
revoke execute on function public.tg_fidc_proposta_numero() from authenticated, anon, public;

-- Quem aprova: papel diretor
create or replace function public.is_diretor(p_empresa uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from membros where empresa_id = p_empresa and user_id = auth.uid() and papel = 'diretor');
$$;
revoke execute on function public.is_diretor(uuid) from anon, public;
grant execute on function public.is_diretor(uuid) to authenticated;

-- RLS
alter table public.fidc_fundos enable row level security;
alter table public.fidc_propostas enable row level security;
alter table public.fidc_proposta_itens enable row level security;

create policy fidc_fundos_sel on public.fidc_fundos for select to authenticated using (public.is_membro(empresa_id));
create policy fidc_fundos_ins on public.fidc_fundos for insert to authenticated with check (public.pode_editar(empresa_id));
create policy fidc_fundos_upd on public.fidc_fundos for update to authenticated using (public.pode_editar(empresa_id)) with check (public.pode_editar(empresa_id));
create policy fidc_fundos_del on public.fidc_fundos for delete to authenticated using (public.is_admin(empresa_id));

-- Proposta: quem edita monta e envia; aprovação/rejeição só pela função (diretor)
create policy fidc_propostas_sel on public.fidc_propostas for select to authenticated using (public.is_membro(empresa_id));
create policy fidc_propostas_ins on public.fidc_propostas for insert to authenticated
  with check (public.pode_editar(empresa_id) and status in ('Rascunho','Pendente'));
create policy fidc_propostas_upd on public.fidc_propostas for update to authenticated
  using (public.pode_editar(empresa_id) and (status in ('Rascunho','Pendente','Rejeitada') or (status = 'Aprovada')))
  with check (public.pode_editar(empresa_id) and status in ('Rascunho','Pendente','Cancelada','Aprovada'));
create policy fidc_propostas_del on public.fidc_propostas for delete to authenticated
  using (public.pode_editar(empresa_id) and status in ('Rascunho','Cancelada','Rejeitada'));

create policy fidc_itens_sel on public.fidc_proposta_itens for select to authenticated using (public.is_membro(empresa_id));
create policy fidc_itens_ins on public.fidc_proposta_itens for insert to authenticated with check (public.pode_editar(empresa_id));
create policy fidc_itens_upd on public.fidc_proposta_itens for update to authenticated using (public.pode_editar(empresa_id)) with check (public.pode_editar(empresa_id));
create policy fidc_itens_del on public.fidc_proposta_itens for delete to authenticated using (public.pode_editar(empresa_id));

-- Impede que a edição comum mude uma proposta aprovada (exceto vincular o borderô original e o comparativo)
create or replace function public.tg_fidc_proposta_guarda() returns trigger
language plpgsql set search_path = public as $$
begin
  if old.status = 'Aprovada' then
    if new.status <> 'Aprovada' or new.valor_face <> old.valor_face or new.fundo_id <> old.fundo_id
       or new.liquido <> old.liquido or new.aprovado_por is distinct from old.aprovado_por then
      raise exception 'Proposta aprovada não pode ser alterada (só vincular o borderô original)';
    end if;
  elsif new.status = 'Aprovada' and current_setting('app.aprovando', true) is distinct from 'sim' then
    raise exception 'Somente o diretor aprova propostas';
  end if;
  return new;
end $$;
create trigger fidc_propostas_guarda before update on public.fidc_propostas
  for each row execute function public.tg_fidc_proposta_guarda();
revoke execute on function public.tg_fidc_proposta_guarda() from authenticated, anon, public;

-- Aprovar ou rejeitar (diretor). Na aprovação: títulos ficam Pagos na conta do fundo na data da operação,
-- e são gerados os lançamentos estimados de juros, tarifas e a transferência do líquido.
create or replace function public.decidir_proposta_fidc(p_id uuid, p_aprovar boolean, p_motivo text default null)
returns text language plpgsql security definer set search_path = public as $$
declare pr fidc_propostas; fu fidc_fundos; n_aberto int; n_itens int; v_origem text;
        pl_jur uuid; pl_tar uuid; pl_rec uuid; pl_td uuid; pl_tc uuid; v_cc uuid;
begin
  select * into pr from fidc_propostas where id = p_id for update;
  if not found then raise exception 'Proposta não encontrada'; end if;
  if not is_diretor(pr.empresa_id) then raise exception 'Somente o diretor pode aprovar ou rejeitar propostas'; end if;
  if pr.status <> 'Pendente' then raise exception 'A proposta nº % não está pendente (status: %)', pr.numero, pr.status; end if;

  if not p_aprovar then
    update fidc_propostas set status = 'Rejeitada', motivo = p_motivo, aprovado_por = auth.uid(), aprovado_em = now() where id = p_id;
    return 'Rejeitada';
  end if;

  select * into fu from fidc_fundos where id = pr.fundo_id;
  if fu.conta_id is null then raise exception 'Cadastre a conta do fundo % antes de aprovar', fu.nome; end if;
  select count(*), count(*) filter (where l.status = 'Em aberto' and l.fidc_proposta_id is null)
    into n_itens, n_aberto
    from fidc_proposta_itens i join lancamentos l on l.id = i.lancamento_id where i.proposta_id = p_id;
  if n_itens = 0 then raise exception 'Proposta sem títulos vinculados'; end if;
  if n_aberto <> n_itens then raise exception '% título(s) já não estão em aberto ou estão em outra proposta', n_itens - n_aberto; end if;

  select id into pl_jur from plano_contas where empresa_id = pr.empresa_id and codigo = '2.07.08';
  select id into pl_tar from plano_contas where empresa_id = pr.empresa_id and codigo = '2.07.32';
  select id into pl_rec from plano_contas where empresa_id = pr.empresa_id and codigo = '2.07.11';
  select id into pl_td  from plano_contas where empresa_id = pr.empresa_id and codigo = '3.02.01';
  select id into pl_tc  from plano_contas where empresa_id = pr.empresa_id and codigo = '3.01.01';
  select id into v_cc from centros_custo where empresa_id = pr.empresa_id and nome = 'FINANCEIRO';
  v_origem := 'fidc:proposta:' || pr.numero;

  perform set_config('app.aprovando', 'sim', true);
  update lancamentos l set status = 'Pago', data = pr.data_operacao, conta_id = fu.conta_id, fidc_proposta_id = p_id
    from fidc_proposta_itens i where i.proposta_id = p_id and i.lancamento_id = l.id;

  if pl_jur is not null and pr.desagio > 0 then
    insert into lancamentos(empresa_id, data, plano_id, descricao, centro_custo_id, status, conta_id, valor, origem, fidc_proposta_id)
    values (pr.empresa_id, pr.data_operacao, pl_jur, format('%s — deságio proposta nº %s (estimado)', fu.nome, pr.numero), v_cc, 'Pago', fu.conta_id, pr.desagio, v_origem, p_id);
  end if;
  if pl_tar is not null and pr.ad_valorem + pr.tarifas + pr.iof > 0 then
    insert into lancamentos(empresa_id, data, plano_id, descricao, centro_custo_id, status, conta_id, valor, origem, fidc_proposta_id)
    values (pr.empresa_id, pr.data_operacao, pl_tar, format('%s — tarifas/IOF proposta nº %s (estimado)', fu.nome, pr.numero), v_cc, 'Pago', fu.conta_id, pr.ad_valorem + pr.tarifas + pr.iof, v_origem, p_id);
  end if;
  if pl_rec is not null and pr.recompras > 0 then
    insert into lancamentos(empresa_id, data, plano_id, descricao, centro_custo_id, status, conta_id, valor, origem, fidc_proposta_id)
    values (pr.empresa_id, pr.data_operacao, pl_rec, format('%s — recompras descontadas proposta nº %s', fu.nome, pr.numero), v_cc, 'Pago', fu.conta_id, pr.recompras, v_origem, p_id);
  end if;
  if pl_td is not null and pl_tc is not null and pr.liquido > 0 and coalesce(pr.conta_credito_id, fu.conta_credito_id) is not null then
    insert into lancamentos(empresa_id, data, plano_id, descricao, centro_custo_id, status, conta_id, valor, origem, fidc_proposta_id)
    values (pr.empresa_id, pr.data_operacao, pl_td, format('%s — líquido proposta nº %s', fu.nome, pr.numero), v_cc, 'Pago', fu.conta_id, pr.liquido, v_origem, p_id),
           (pr.empresa_id, pr.data_operacao, pl_tc, format('%s — líquido proposta nº %s', fu.nome, pr.numero), v_cc, 'Pago', coalesce(pr.conta_credito_id, fu.conta_credito_id), pr.liquido, v_origem, p_id);
  end if;

  update fidc_propostas set status = 'Aprovada', motivo = p_motivo, aprovado_por = auth.uid(), aprovado_em = now() where id = p_id;
  return 'Aprovada';
end $$;
revoke execute on function public.decidir_proposta_fidc(uuid, boolean, text) from anon, public;
grant execute on function public.decidir_proposta_fidc(uuid, boolean, text) to authenticated;

revoke all on public.fidc_fundos, public.fidc_propostas, public.fidc_proposta_itens from anon;
grant select, insert, update, delete on public.fidc_fundos, public.fidc_propostas, public.fidc_proposta_itens to authenticated;

-- ===== 20261006000007_fidc_proposta_operacao.sql
-- Proposta aprovada vira a operação oficial na base FIDC (fidc_operacoes/fidc_titulos), com borderô "P<nº>".
-- operacao_id passa a apontar para essa operação; o borderô original do fundo fica só no comparativo.
create or replace function public.decidir_proposta_fidc(p_id uuid, p_aprovar boolean, p_motivo text default null)
returns text language plpgsql security definer set search_path = public as $$
declare pr fidc_propostas; fu fidc_fundos; n_aberto int; n_itens int; v_origem text; v_op uuid;
        pl_jur uuid; pl_tar uuid; pl_rec uuid; pl_td uuid; pl_tc uuid; v_cc uuid;
begin
  select * into pr from fidc_propostas where id = p_id for update;
  if not found then raise exception 'Proposta não encontrada'; end if;
  if not is_diretor(pr.empresa_id) then raise exception 'Somente o diretor pode aprovar ou rejeitar propostas'; end if;
  if pr.status <> 'Pendente' then raise exception 'A proposta nº % não está pendente (status: %)', pr.numero, pr.status; end if;

  if not p_aprovar then
    update fidc_propostas set status = 'Rejeitada', motivo = p_motivo, aprovado_por = auth.uid(), aprovado_em = now() where id = p_id;
    return 'Rejeitada';
  end if;

  select * into fu from fidc_fundos where id = pr.fundo_id;
  if fu.conta_id is null then raise exception 'Cadastre a conta do fundo % antes de aprovar', fu.nome; end if;
  select count(*), count(*) filter (where l.status = 'Em aberto' and l.fidc_proposta_id is null)
    into n_itens, n_aberto
    from fidc_proposta_itens i join lancamentos l on l.id = i.lancamento_id where i.proposta_id = p_id;
  if n_itens = 0 then raise exception 'Proposta sem títulos vinculados'; end if;
  if n_aberto <> n_itens then raise exception '% título(s) já não estão em aberto ou estão em outra proposta', n_itens - n_aberto; end if;

  select id into pl_jur from plano_contas where empresa_id = pr.empresa_id and codigo = '2.07.08';
  select id into pl_tar from plano_contas where empresa_id = pr.empresa_id and codigo = '2.07.32';
  select id into pl_rec from plano_contas where empresa_id = pr.empresa_id and codigo = '2.07.11';
  select id into pl_td  from plano_contas where empresa_id = pr.empresa_id and codigo = '3.02.01';
  select id into pl_tc  from plano_contas where empresa_id = pr.empresa_id and codigo = '3.01.01';
  select id into v_cc from centros_custo where empresa_id = pr.empresa_id and nome = 'FINANCEIRO';
  v_origem := 'fidc:proposta:' || pr.numero;

  perform set_config('app.aprovando', 'sim', true);
  update lancamentos l set status = 'Pago', data = pr.data_operacao, conta_id = fu.conta_id, fidc_proposta_id = p_id
    from fidc_proposta_itens i where i.proposta_id = p_id and i.lancamento_id = l.id;

  if pl_jur is not null and pr.desagio > 0 then
    insert into lancamentos(empresa_id, data, plano_id, descricao, centro_custo_id, status, conta_id, valor, origem, fidc_proposta_id)
    values (pr.empresa_id, pr.data_operacao, pl_jur, format('%s — deságio proposta nº %s (estimado)', fu.nome, pr.numero), v_cc, 'Pago', fu.conta_id, pr.desagio, v_origem, p_id);
  end if;
  if pl_tar is not null and pr.ad_valorem + pr.tarifas + pr.iof > 0 then
    insert into lancamentos(empresa_id, data, plano_id, descricao, centro_custo_id, status, conta_id, valor, origem, fidc_proposta_id)
    values (pr.empresa_id, pr.data_operacao, pl_tar, format('%s — tarifas/IOF proposta nº %s (estimado)', fu.nome, pr.numero), v_cc, 'Pago', fu.conta_id, pr.ad_valorem + pr.tarifas + pr.iof, v_origem, p_id);
  end if;
  if pl_rec is not null and pr.recompras > 0 then
    insert into lancamentos(empresa_id, data, plano_id, descricao, centro_custo_id, status, conta_id, valor, origem, fidc_proposta_id)
    values (pr.empresa_id, pr.data_operacao, pl_rec, format('%s — recompras descontadas proposta nº %s', fu.nome, pr.numero), v_cc, 'Pago', fu.conta_id, pr.recompras, v_origem, p_id);
  end if;
  if pl_td is not null and pl_tc is not null and pr.liquido > 0 and coalesce(pr.conta_credito_id, fu.conta_credito_id) is not null then
    insert into lancamentos(empresa_id, data, plano_id, descricao, centro_custo_id, status, conta_id, valor, origem, fidc_proposta_id)
    values (pr.empresa_id, pr.data_operacao, pl_td, format('%s — líquido proposta nº %s', fu.nome, pr.numero), v_cc, 'Pago', fu.conta_id, pr.liquido, v_origem, p_id),
           (pr.empresa_id, pr.data_operacao, pl_tc, format('%s — líquido proposta nº %s', fu.nome, pr.numero), v_cc, 'Pago', coalesce(pr.conta_credito_id, fu.conta_credito_id), pr.liquido, v_origem, p_id);
  end if;

  -- A proposta aprovada passa a ser a operação oficial na base FIDC (borderô "P<nº>"), alimentando a Análise FIDC.
  insert into fidc_operacoes(empresa_id, fundo, data, bordero, arquivo, conta_id, qtd_titulos, valor_face, desagio, ad_valorem, tarifas, iof,
                             encargos, recompra, desc_sacado, liquido, prazo_medio, prazo_cobrado, observacao)
  values (pr.empresa_id, fu.nome, pr.data_operacao, 'P' || pr.numero, 'Proposta nº ' || pr.numero || ' (plataforma)', fu.conta_id, pr.qtd_titulos,
          pr.valor_face, pr.desagio, pr.ad_valorem, pr.tarifas, pr.iof, 0, pr.recompras, 0, pr.liquido, pr.prazo_medio, pr.prazo_cobrado,
          nullif(concat_ws('; ', pr.observacao, p_motivo), ''))
  returning id into v_op;
  insert into fidc_titulos(empresa_id, operacao_id, fundo, bordero, data_operacao, titulo, vencimento, valor, cnpj_sacado, sacado, sacado_agrupado)
  select pr.empresa_id, v_op, fu.nome, 'P' || pr.numero, pr.data_operacao, i.documento, i.vencimento, i.valor, i.cnpj, i.sacado, i.sacado
    from fidc_proposta_itens i where i.proposta_id = p_id;

  update fidc_propostas set status = 'Aprovada', motivo = p_motivo, aprovado_por = auth.uid(), aprovado_em = now(), operacao_id = v_op where id = p_id;
  return 'Aprovada';
end $$;
revoke execute on function public.decidir_proposta_fidc(uuid, boolean, text) from anon, public;
grant execute on function public.decidir_proposta_fidc(uuid, boolean, text) to authenticated;
comment on column public.fidc_propostas.operacao_id is 'Operação criada na base FIDC na aprovação (borderô P<nº>)';

-- Proposta aprovada: só o comparativo pode mudar (operação vinculada é fixa)
create or replace function public.tg_fidc_proposta_guarda() returns trigger
language plpgsql set search_path = public as $$
begin
  if old.status = 'Aprovada' then
    if new.status <> 'Aprovada' or new.valor_face <> old.valor_face or new.fundo_id <> old.fundo_id
       or new.liquido <> old.liquido or new.aprovado_por is distinct from old.aprovado_por
       or (old.operacao_id is not null and new.operacao_id is distinct from old.operacao_id) then
      raise exception 'Proposta aprovada não pode ser alterada (só registrar a comparação com o borderô original)';
    end if;
  elsif new.status = 'Aprovada' and current_setting('app.aprovando', true) is distinct from 'sim' then
    raise exception 'Somente o diretor aprova propostas';
  end if;
  return new;
end $$;
revoke execute on function public.tg_fidc_proposta_guarda() from authenticated, anon, public;

-- ===== 20261006000008_fidc_fundos_custos.sql
-- Custos de operação separados nas condições dos fundos (pedido do Renan em 06/10):
-- tarifa_operacao = TED / tarifa fixa por borderô; tarifa_titulo = boleto / cobrança por título;
-- custo_assinatura = assinatura eletrônica por borderô; custo_consulta = consulta Serasa por sacado novo no fundo.
alter table public.fidc_fundos
  add column if not exists custo_assinatura numeric(12,2) not null default 0,
  add column if not exists custo_consulta numeric(12,2) not null default 0;
comment on column public.fidc_fundos.tarifa_operacao is 'TED / tarifa fixa por borderô (R$)';
comment on column public.fidc_fundos.tarifa_titulo is 'Boleto / cobrança por título (R$)';
comment on column public.fidc_fundos.custo_assinatura is 'Assinatura eletrônica por borderô (R$)';
comment on column public.fidc_fundos.custo_consulta is 'Consulta Serasa por sacado novo no fundo (R$)';
-- Valores dos borderôs de set/2026: FS = TED 20 + assinatura 70 + boleto 4,50/título (a linha "CONSULTA SERASA 22,00"
-- de 10/09 é, segundo o Renan, assinatura do borderô — FS não cobra consulta);
-- Negocial = 15 por borderô + 2,50 por título (despesas bancárias).
update public.fidc_fundos set tarifa_operacao = 20, custo_assinatura = 70, tarifa_titulo = 4.50, custo_consulta = 0 where nome = 'FS';
update public.fidc_fundos set tarifa_operacao = 15, tarifa_titulo = 2.50 where nome = 'Negocial';

-- ===== 20261006000009_v_lancamentos_nf.sql
-- v_lancamentos passa a expor NF-parcela (documento), emissão e a proposta FIDC do título
create or replace view public.v_lancamentos with (security_invoker = on) as
 SELECT l.id, l.empresa_id, l.data, l.plano_id, l.descricao, l.opc1, l.opc2, l.opc3, l.opc4, l.favorecido_id, l.centro_custo_id,
    l.status, l.conta_id, l.valor, l.prioridade, l.origem, l.created_by, l.created_at, l.updated_at,
    (EXTRACT(year FROM l.data))::integer AS ano,
    (EXTRACT(month FROM l.data))::integer AS mes,
    CASE WHEN (p.natureza = 'C'::bpchar) THEN l.valor ELSE (- l.valor) END AS valor_sinal,
    p.codigo AS plano_codigo, p.nome AS plano_nome, p.tipo,
    c1.id AS classe_id, c1.codigo AS classe_codigo, c1.nome AS classe_nome,
    COALESCE(c1.prioridade, 'Negociável'::text) AS prioridade_classe,
    COALESCE(l.prioridade, c1.prioridade, 'Negociável'::text) AS prioridade_efetiva,
    f.nome AS favorecido_nome, f.sigla AS favorecido_sigla,
    cc.nome AS centro_custo_nome, ct.nome AS conta_nome, ct.grupo_id, ct.disponibilidade, g.nome AS grupo_nome,
    l.documento, l.emissao, l.fidc_proposta_id
   FROM lancamentos l
     JOIN plano_contas p ON p.id = l.plano_id
     LEFT JOIN plano_contas c1 ON c1.id = p.pai_id
     LEFT JOIN favorecidos f ON f.id = l.favorecido_id
     LEFT JOIN centros_custo cc ON cc.id = l.centro_custo_id
     LEFT JOIN contas ct ON ct.id = l.conta_id
     LEFT JOIN grupos g ON g.id = ct.grupo_id;

-- ===== 20261006000010_fidc_metodo_desagio.sql
-- Método de cálculo do deságio por fundo (conferido com o borderô FS 001226 de 06/10/2026):
--   'fator'   = por dentro: v·k/(1+k), k = taxa × prazo cobrado / 30 (padrão; usado com a taxa média histórica)
--   'simples' = juros simples sobre a face: v × taxa × prazo cobrado / 30 (é como a FS calcula)
-- FS: 2,46% a.m., juros simples, prazo + 3 dias.
alter table public.fidc_fundos add column if not exists metodo_desagio text not null default 'fator'
  check (metodo_desagio in ('fator', 'simples'));
comment on column public.fidc_fundos.metodo_desagio is 'fator = v·k/(1+k); simples = v × taxa × dias/30 sobre a face';
update public.fidc_fundos set taxa_am = 2.46, dias_compensacao = 3, metodo_desagio = 'simples' where nome = 'FS';

-- ===== 20261006000011_duplicatas_endosso.sql
-- Duplicatas para endosso (06/10): beneficiários do endosso, endereço de clientes e do emitente, registro das emitidas.

-- Endereço e IE dos favorecidos (clientes = sacados das duplicatas; vem do XML da NF-e)
alter table public.favorecidos
  add column if not exists ie text,
  add column if not exists logradouro text,
  add column if not exists numero text,
  add column if not exists complemento text,
  add column if not exists bairro text,
  add column if not exists municipio text,
  add column if not exists uf text,
  add column if not exists cep text;

-- Dados do emitente (empresa) impressos na duplicata
alter table public.empresas
  add column if not exists razao_social text,
  add column if not exists ie text,
  add column if not exists logradouro text,
  add column if not exists municipio text,
  add column if not exists uf text,
  add column if not exists cep text,
  add column if not exists responsavel_nome text,
  add column if not exists responsavel_cpf text,
  add column if not exists avalista_nome text,
  add column if not exists avalista_cpf text;

-- Beneficiários do endosso (fundos, bancos, factorings) com dados completos
create table if not exists public.beneficiarios_endosso (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  nome text not null,                 -- nome curto (FS, Negocial…)
  razao_social text,
  cnpj text,
  logradouro text,
  municipio text,
  uf text,
  cep text,
  praca_pagamento text,               -- "SÃO PAULO/SP"
  fundo_id uuid references public.fidc_fundos(id) on delete set null,
  ativo boolean not null default true,
  observacao text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists beneficiarios_endosso_emp on public.beneficiarios_endosso(empresa_id);

-- Duplicatas emitidas e endossadas (o PDF é assinado fora, com certificado digital)
create table if not exists public.duplicatas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  lancamento_id uuid references public.lancamentos(id) on delete set null,
  numero text not null,               -- NF-parcela
  fatura text,
  emissao date,
  vencimento date not null,
  valor numeric(14,2) not null,
  sacado_id uuid references public.favorecidos(id) on delete set null,
  beneficiario_id uuid references public.beneficiarios_endosso(id) on delete set null,
  proposta_id uuid references public.fidc_propostas(id) on delete set null,
  lote text,                          -- identificador do PDF gerado
  dados jsonb,                        -- retrato do que foi impresso (emitente, sacado, beneficiário)
  emitida_em timestamptz not null default now(),
  emitida_por uuid default auth.uid()
);
create index if not exists duplicatas_lanc on public.duplicatas(lancamento_id);
create index if not exists duplicatas_emp on public.duplicatas(empresa_id, emitida_em);

alter table public.beneficiarios_endosso enable row level security;
alter table public.duplicatas enable row level security;
create policy benef_sel on public.beneficiarios_endosso for select to authenticated using (public.is_membro(empresa_id));
create policy benef_ins on public.beneficiarios_endosso for insert to authenticated with check (public.pode_editar(empresa_id));
create policy benef_upd on public.beneficiarios_endosso for update to authenticated using (public.pode_editar(empresa_id)) with check (public.pode_editar(empresa_id));
create policy benef_del on public.beneficiarios_endosso for delete to authenticated using (public.pode_editar(empresa_id));
create policy dup_sel on public.duplicatas for select to authenticated using (public.is_membro(empresa_id));
create policy dup_ins on public.duplicatas for insert to authenticated with check (public.pode_editar(empresa_id));
create policy dup_del on public.duplicatas for delete to authenticated using (public.pode_editar(empresa_id));
revoke all on public.beneficiarios_endosso, public.duplicatas from anon;
grant select, insert, update, delete on public.beneficiarios_endosso, public.duplicatas to authenticated;

-- ===== 20261006000012_endosso_fornecedor.sql
-- Endosso para fornecedores (06/10): beneficiário pode ser fornecedor do cadastro de favorecidos;
-- modalidade do endosso (translativo ou em garantia) e referência da garantia registradas na duplicata.
alter table public.beneficiarios_endosso
  add column if not exists tipo text not null default 'FIDC' check (tipo in ('FIDC', 'Fornecedor', 'Banco', 'Outro')),
  add column if not exists favorecido_id uuid references public.favorecidos(id) on delete set null;
alter table public.duplicatas
  add column if not exists modalidade text not null default 'translativo' check (modalidade in ('translativo', 'garantia')),
  add column if not exists referencia text;

-- ===== 20261006000013_cancelamento_endosso.sql
-- Cancelamento de endosso (06/10): recusa do beneficiário ou desistência da IPLAMM.
-- O registro fica no histórico com status 'cancelada', data e motivo; os títulos ficam livres para novo endosso.
alter table public.duplicatas
  add column if not exists status text not null default 'ativa' check (status in ('ativa', 'cancelada')),
  add column if not exists cancelada_em timestamptz,
  add column if not exists cancelada_por uuid default null,
  add column if not exists motivo_cancelamento text;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'duplicatas' and policyname = 'dup_upd') then
    create policy dup_upd on public.duplicatas for update to authenticated using (public.pode_editar(empresa_id)) with check (public.pode_editar(empresa_id));
  end if;
end $$;

-- ===== 20261007000014_beneficiarios_parametros.sql
-- Cadastro de beneficiários (favorecidos) por tipo, com parâmetros (07/10): base para conformidade,
-- cadastro a partir de NF-e de entrada/saída e, adiante, cálculo de impostos.
alter table public.favorecidos
  add column if not exists tipo_pessoa text check (tipo_pessoa in ('PJ', 'PF')),
  add column if not exists nome_fantasia text,
  add column if not exists im text,
  add column if not exists email text,
  add column if not exists telefone text,
  add column if not exists pix text,
  add column if not exists observacao text,
  -- fiscais
  add column if not exists regime_tributario text,          -- Simples Nacional, Lucro Presumido, Lucro Real, MEI, Não se aplica
  add column if not exists contribuinte_icms text,          -- 1 contribuinte, 2 isento, 9 não contribuinte (indIEDest da NF-e)
  add column if not exists consumidor_final boolean,
  -- comerciais / financeiros
  add column if not exists limite_credito numeric(16,2),
  add column if not exists prazo_padrao text,               -- ex.: 28/42/56
  add column if not exists plano_padrao_id uuid references public.plano_contas(id) on delete set null,
  add column if not exists centro_custo_padrao_id uuid references public.centros_custo(id) on delete set null,
  add column if not exists prioridade_padrao text,          -- Obrigatório / Negociável (fornecedores)
  add column if not exists representante_id uuid references public.favorecidos(id) on delete set null,
  add column if not exists retencoes jsonb,                 -- {"irrf":1.5,"csrf":4.65,"inss":11,"iss":5} (% sobre o serviço)
  add column if not exists updated_at timestamptz default now();
create index if not exists favorecidos_doc on public.favorecidos(empresa_id, documento);

-- =====================================================================
-- Conciliação bancária por extrato OFX (07/10)
-- extrato_importacoes: cada arquivo importado (período e saldo informado pelo banco)
-- extrato_itens: movimentos do extrato (valor com sinal: + crédito, − débito), sem duplicar pelo FITID
-- conciliacoes: vínculo item do extrato ↔ lançamento (um item pode cobrir vários lançamentos; cada lançamento concilia uma vez)
alter table public.contas
  add column if not exists ofx_banco text,
  add column if not exists ofx_conta text;

create table if not exists public.extrato_importacoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  conta_id uuid not null references public.contas(id) on delete cascade,
  arquivo text, banco text, agencia text, conta_ofx text,
  dt_inicio date, dt_fim date, saldo_final numeric(16,2), saldo_data date,
  qtd int not null default 0, novos int not null default 0,
  created_by uuid default auth.uid(), created_at timestamptz not null default now()
);
create index if not exists extrato_imp_conta on public.extrato_importacoes(empresa_id, conta_id, saldo_data);

create table if not exists public.extrato_itens (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  conta_id uuid not null references public.contas(id) on delete cascade,
  importacao_id uuid references public.extrato_importacoes(id) on delete set null,
  data date not null,
  valor numeric(16,2) not null,
  tipo text, fitid text not null, descricao text, documento text,
  status text not null default 'pendente' check (status in ('pendente','conciliado','ignorado')),
  observacao text,
  conciliado_em timestamptz, conciliado_por uuid,
  created_at timestamptz not null default now(),
  unique (empresa_id, conta_id, fitid)
);
create index if not exists extrato_itens_conta_data on public.extrato_itens(empresa_id, conta_id, data);

create table if not exists public.conciliacoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  conta_id uuid not null references public.contas(id) on delete cascade,
  extrato_id uuid not null references public.extrato_itens(id) on delete cascade,
  lancamento_id uuid not null references public.lancamentos(id) on delete cascade,
  created_by uuid default auth.uid(), created_at timestamptz not null default now(),
  unique (lancamento_id)
);
create index if not exists conciliacoes_extrato on public.conciliacoes(extrato_id);
create index if not exists conciliacoes_conta on public.conciliacoes(empresa_id, conta_id);

-- Se o último vínculo de um item some (ex.: lançamento excluído), o item volta a pendente
create or replace function public.tg_conciliacao_removida() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update extrato_itens set status = 'pendente', conciliado_em = null, conciliado_por = null
   where id = old.extrato_id and status = 'conciliado'
     and not exists (select 1 from conciliacoes c where c.extrato_id = old.extrato_id);
  return old;
end $$;
revoke execute on function public.tg_conciliacao_removida() from public, anon, authenticated;
create trigger conciliacao_removida after delete on public.conciliacoes
  for each row execute function public.tg_conciliacao_removida();

alter table public.extrato_importacoes enable row level security;
alter table public.extrato_itens enable row level security;
alter table public.conciliacoes enable row level security;
create policy extimp_sel on public.extrato_importacoes for select to authenticated using (public.is_membro(empresa_id));
create policy extimp_ins on public.extrato_importacoes for insert to authenticated with check (public.pode_editar(empresa_id));
create policy extimp_upd on public.extrato_importacoes for update to authenticated using (public.pode_editar(empresa_id)) with check (public.pode_editar(empresa_id));
create policy extimp_del on public.extrato_importacoes for delete to authenticated using (public.pode_editar(empresa_id));
create policy extitem_sel on public.extrato_itens for select to authenticated using (public.is_membro(empresa_id));
create policy extitem_ins on public.extrato_itens for insert to authenticated with check (public.pode_editar(empresa_id));
create policy extitem_upd on public.extrato_itens for update to authenticated using (public.pode_editar(empresa_id)) with check (public.pode_editar(empresa_id));
create policy extitem_del on public.extrato_itens for delete to authenticated using (public.pode_editar(empresa_id));
create policy conc_sel on public.conciliacoes for select to authenticated using (public.is_membro(empresa_id));
create policy conc_ins on public.conciliacoes for insert to authenticated with check (public.pode_editar(empresa_id));
create policy conc_del on public.conciliacoes for delete to authenticated using (public.pode_editar(empresa_id));
grant select, insert, update, delete on public.extrato_importacoes, public.extrato_itens to authenticated;
grant select, insert, delete on public.conciliacoes to authenticated;

-- =====================================================================
-- Conciliação N:N (07/10): vários movimentos do extrato ↔ vários lançamentos.
-- Todos os movimentos e vínculos do conjunto levam o mesmo grupo_id; os vínculos apontam para o primeiro movimento.
alter table public.extrato_itens add column if not exists grupo_id uuid;
alter table public.conciliacoes add column if not exists grupo_id uuid;
create index if not exists extrato_itens_grupo on public.extrato_itens(grupo_id) where grupo_id is not null;
create index if not exists conciliacoes_grupo on public.conciliacoes(grupo_id) where grupo_id is not null;

-- Se um vínculo some (ex.: lançamento excluído): item sem vínculo volta a pendente; num grupo, o grupo todo volta.
create or replace function public.tg_conciliacao_removida() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.grupo_id is not null then
    update extrato_itens set status = 'pendente', conciliado_em = null, conciliado_por = null, grupo_id = null
     where grupo_id = old.grupo_id and status = 'conciliado';
  else
    update extrato_itens set status = 'pendente', conciliado_em = null, conciliado_por = null
     where id = old.extrato_id and status = 'conciliado'
       and not exists (select 1 from conciliacoes c where c.extrato_id = old.extrato_id);
  end if;
  return old;
end $$;
revoke execute on function public.tg_conciliacao_removida() from public, anon, authenticated;

-- =====================================================================
-- Lançamento conciliado com o extrato (07/10): não pode ser excluído e só aceita mudança nas descrições
-- (descrição e opcionais 1–4). Para alterar o resto, desfaça a conciliação antes.
-- Exclusões em cascata (ex.: exclusão da empresa) passam (pg_trigger_depth > 1).
create or replace function public.tg_lanc_conciliado() returns trigger
language plpgsql set search_path = public as $$
begin
  if pg_trigger_depth() > 1 then return coalesce(new, old); end if;
  if not exists (select 1 from conciliacoes c where c.lancamento_id = old.id) then return coalesce(new, old); end if;
  if tg_op = 'DELETE' then
    raise exception 'Lançamento conciliado com o extrato bancário: desfaça a conciliação antes de excluir';
  end if;
  if (new.data, new.valor, new.plano_id, new.conta_id, new.status, new.favorecido_id, new.centro_custo_id, new.prioridade, new.documento, new.emissao, new.empresa_id)
     is distinct from
     (old.data, old.valor, old.plano_id, old.conta_id, old.status, old.favorecido_id, old.centro_custo_id, old.prioridade, old.documento, old.emissao, old.empresa_id) then
    raise exception 'Lançamento conciliado com o extrato bancário: só a descrição e os opcionais podem ser alterados';
  end if;
  return new;
end $$;
revoke execute on function public.tg_lanc_conciliado() from public, anon, authenticated;
create trigger lanc_conciliado_upd before update on public.lancamentos for each row execute function public.tg_lanc_conciliado();
create trigger lanc_conciliado_del before delete on public.lancamentos for each row execute function public.tg_lanc_conciliado();

-- =====================================================================
-- Notas fiscais (07/10): NF-e completas (cabeçalho, itens com impostos, parcelas) importadas dos XML,
-- e o vínculo de cada parcela/nota com os lançamentos de recebimento que já existem.
-- Nada aqui altera lançamentos: o vínculo fica em nfe_vinculos e só é gravado após aprovação.
create table if not exists public.nfe_notas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  chave text not null,
  modelo text, serie text, numero int not null,
  emissao date not null,
  tipo text not null check (tipo in ('saida','entrada')),      -- tpNF 1 / 0
  emissao_propria boolean not null default true,                 -- emitida pela empresa
  finalidade text,                                               -- finNFe: 1 normal, 2 complementar, 3 ajuste, 4 devolução
  natureza text, cfops text[],
  emit_doc text, emit_nome text, dest_doc text, dest_nome text, dest_uf text, dest_ind_ie text, consumidor_final boolean,
  favorecido_id uuid references public.favorecidos(id) on delete set null,
  v_prod numeric(16,2), v_desc numeric(16,2), v_frete numeric(16,2), v_seg numeric(16,2), v_outro numeric(16,2), v_nf numeric(16,2),
  v_bc_icms numeric(16,2), v_icms numeric(16,2), v_icms_deson numeric(16,2), v_fcp numeric(16,2), v_bc_st numeric(16,2), v_st numeric(16,2),
  v_ipi numeric(16,2), v_pis numeric(16,2), v_cofins numeric(16,2), v_bc_ibscbs numeric(16,2), v_ibs numeric(16,2), v_cbs numeric(16,2), v_tot_trib numeric(16,2),
  situacao text not null default 'autorizada' check (situacao in ('autorizada','cancelada','denegada','outra')),
  cstat text, protocolo text, eventos jsonb not null default '[]'::jsonb,
  inf_cpl text, arquivo text, xml text,
  importado_em timestamptz not null default now(), importado_por uuid default auth.uid(),
  unique (empresa_id, chave)
);
create index if not exists nfe_notas_emp_emissao on public.nfe_notas(empresa_id, emissao);
create index if not exists nfe_notas_emp_numero on public.nfe_notas(empresa_id, numero);
create index if not exists nfe_notas_fav on public.nfe_notas(favorecido_id);

create table if not exists public.nfe_itens (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  nota_id uuid not null references public.nfe_notas(id) on delete cascade,
  n_item int not null,
  cprod text, xprod text, ncm text, cest text, cfop text, ucom text,
  qcom numeric(18,4), vuncom numeric(20,10), vprod numeric(16,2), vdesc numeric(16,2), vfrete numeric(16,2), voutro numeric(16,2),
  orig text, cst_icms text, v_bc_icms numeric(16,2), p_icms numeric(8,4), v_icms numeric(16,2), v_bc_st numeric(16,2), v_st numeric(16,2),
  cst_ipi text, v_ipi numeric(16,2), cst_pis text, v_pis numeric(16,2), cst_cofins text, v_cofins numeric(16,2),
  cst_ibscbs text, cclass_trib text, v_ibs numeric(16,2), v_cbs numeric(16,2), v_tot_trib numeric(16,2)
);
create index if not exists nfe_itens_nota on public.nfe_itens(nota_id);
create index if not exists nfe_itens_emp_ncm on public.nfe_itens(empresa_id, ncm);

create table if not exists public.nfe_parcelas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  nota_id uuid not null references public.nfe_notas(id) on delete cascade,
  numero int not null, vencimento date, valor numeric(16,2) not null,
  a_vista boolean not null default false   -- nota sem duplicatas: uma parcela com o valor da nota na emissão
);
create index if not exists nfe_parcelas_nota on public.nfe_parcelas(nota_id);

create table if not exists public.nfe_vinculos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  nota_id uuid not null references public.nfe_notas(id) on delete cascade,
  parcela_id uuid references public.nfe_parcelas(id) on delete cascade,
  lancamento_id uuid not null references public.lancamentos(id) on delete cascade,
  tipo text not null check (tipo in ('exata','soma','nota','parcial','valor_diferente','manual')),
  criado_por uuid default auth.uid(), criado_em timestamptz not null default now(),
  unique (lancamento_id)
);
create index if not exists nfe_vinculos_nota on public.nfe_vinculos(nota_id);
create index if not exists nfe_vinculos_parcela on public.nfe_vinculos(parcela_id);

alter table public.nfe_notas enable row level security;
alter table public.nfe_itens enable row level security;
alter table public.nfe_parcelas enable row level security;
alter table public.nfe_vinculos enable row level security;
create policy nfe_notas_sel on public.nfe_notas for select to authenticated using (public.is_membro(empresa_id));
create policy nfe_notas_ins on public.nfe_notas for insert to authenticated with check (public.pode_editar(empresa_id));
create policy nfe_notas_upd on public.nfe_notas for update to authenticated using (public.pode_editar(empresa_id)) with check (public.pode_editar(empresa_id));
create policy nfe_notas_del on public.nfe_notas for delete to authenticated using (public.pode_editar(empresa_id));
create policy nfe_itens_sel on public.nfe_itens for select to authenticated using (public.is_membro(empresa_id));
create policy nfe_itens_ins on public.nfe_itens for insert to authenticated with check (public.pode_editar(empresa_id));
create policy nfe_itens_del on public.nfe_itens for delete to authenticated using (public.pode_editar(empresa_id));
create policy nfe_parcelas_sel on public.nfe_parcelas for select to authenticated using (public.is_membro(empresa_id));
create policy nfe_parcelas_ins on public.nfe_parcelas for insert to authenticated with check (public.pode_editar(empresa_id));
create policy nfe_parcelas_del on public.nfe_parcelas for delete to authenticated using (public.pode_editar(empresa_id));
create policy nfe_vinculos_sel on public.nfe_vinculos for select to authenticated using (public.is_membro(empresa_id));
create policy nfe_vinculos_ins on public.nfe_vinculos for insert to authenticated with check (public.pode_editar(empresa_id));
create policy nfe_vinculos_del on public.nfe_vinculos for delete to authenticated using (public.pode_editar(empresa_id));
grant select, insert, update, delete on public.nfe_notas to authenticated;
grant select, insert, delete on public.nfe_itens, public.nfe_parcelas, public.nfe_vinculos to authenticated;

-- ===== 20261008000019_nfe_fidc_vinculos.sql =====
-- Borderôs × notas (08/10): liga cada título da base FIDC (fidc_titulos) à nota / parcela de onde ele veio.
-- Só aditivo: nada em fidc_titulos, fidc_operacoes, lançamentos ou notas é alterado; o vínculo fica aqui e é gravado após aprovação.
create table if not exists public.nfe_fidc_vinculos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  nota_id uuid not null references public.nfe_notas(id) on delete cascade,
  parcela_id uuid references public.nfe_parcelas(id) on delete cascade,
  fidc_titulo_id uuid not null references public.fidc_titulos(id) on delete cascade,
  tipo text not null check (tipo in ('exata','valor_diferente','manual')),
  criado_por uuid default auth.uid(), criado_em timestamptz not null default now(),
  unique (fidc_titulo_id)
);
create index if not exists nfe_fidc_vinculos_nota on public.nfe_fidc_vinculos(nota_id);
create index if not exists nfe_fidc_vinculos_parcela on public.nfe_fidc_vinculos(parcela_id);

alter table public.nfe_fidc_vinculos enable row level security;
create policy nfe_fidc_vinculos_sel on public.nfe_fidc_vinculos for select to authenticated using (public.is_membro(empresa_id));
create policy nfe_fidc_vinculos_ins on public.nfe_fidc_vinculos for insert to authenticated with check (public.pode_editar(empresa_id));
create policy nfe_fidc_vinculos_del on public.nfe_fidc_vinculos for delete to authenticated using (public.pode_editar(empresa_id));
grant select, insert, delete on public.nfe_fidc_vinculos to authenticated;

-- ===== 20261008000020_propostas_da_base_fidc.sql =====
-- Propostas de borderô a partir dos borderôs da base FIDC (08/10).
-- Borderôs já realizados (até 31/08) entram como propostas Aprovadas, ligadas à operação original;
-- os de setembro entram como Pendentes para o diretor aprovar. Só aditivo: lançamentos não são tocados aqui.
alter table public.fidc_propostas add column if not exists origem text not null default 'plataforma';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'fidc_propostas_origem_chk') then
    alter table public.fidc_propostas add constraint fidc_propostas_origem_chk check (origem in ('plataforma','base_fidc'));
  end if;
end $$;
alter table public.fidc_proposta_itens add column if not exists fidc_titulo_id uuid references public.fidc_titulos(id) on delete set null;
create index if not exists fidc_proposta_itens_t on public.fidc_proposta_itens(fidc_titulo_id);

-- NF e parcela de um texto de título/documento: "33775-001", "1-33775/1", "36328-1", "33695" (parcela 1)
create or replace function public.nf_parcela(p text) returns int[]
language sql immutable set search_path = public as $$
  select case
    when p ~ '^\s*\d+-\d{3,7}/\d{1,3}\s*$' then array[(regexp_match(p, '^\s*\d+-(\d+)/(\d+)'))[1]::int, (regexp_match(p, '^\s*\d+-(\d+)/(\d+)'))[2]::int]
    when p ~ '^\s*0*\d{3,7}\s*[-/.]\s*0*\d{1,3}\s*$' then array[(regexp_match(p, '^\s*0*(\d+)\s*[-/.]\s*0*(\d+)'))[1]::int, (regexp_match(p, '^\s*0*(\d+)\s*[-/.]\s*0*(\d+)'))[2]::int]
    when p ~ '^\s*0*\d{3,7}\s*$' then array[(regexp_match(p, '(\d+)'))[1]::int, 1]
    else null end
$$;

-- Aprovação: proposta vinda da base FIDC usa a operação original (não cria P<nº>), liga sozinha os itens
-- aos títulos Em aberto (mesma NF, parcela e valor) e lança os custos reais do borderô.
create or replace function public.decidir_proposta_fidc(p_id uuid, p_aprovar boolean, p_motivo text default null)
returns text language plpgsql security definer set search_path = public as $$
declare pr fidc_propostas; fu fidc_fundos; n_aberto int; n_itens int; n_sem int; v_origem text; v_op uuid; v_rot text;
        pl_jur uuid; pl_tar uuid; pl_rec uuid; pl_td uuid; pl_tc uuid; v_cc uuid;
begin
  select * into pr from fidc_propostas where id = p_id for update;
  if not found then raise exception 'Proposta não encontrada'; end if;
  if not is_diretor(pr.empresa_id) then raise exception 'Somente o diretor pode aprovar ou rejeitar propostas'; end if;
  if pr.status <> 'Pendente' then raise exception 'A proposta nº % não está pendente (status: %)', pr.numero, pr.status; end if;

  if not p_aprovar then
    update fidc_propostas set status = 'Rejeitada', motivo = p_motivo, aprovado_por = auth.uid(), aprovado_em = now() where id = p_id;
    return 'Rejeitada';
  end if;

  select * into fu from fidc_fundos where id = pr.fundo_id;
  if fu.conta_id is null then raise exception 'Cadastre a conta do fundo % antes de aprovar', fu.nome; end if;

  if pr.origem = 'base_fidc' then
    -- liga os itens ainda sem título aos lançamentos Em aberto da mesma NF/parcela/valor (um para um)
    update fidc_proposta_itens i set lancamento_id = x.lid
      from (select distinct on (i2.id) i2.id iid, l.id lid
              from fidc_proposta_itens i2
              join lancamentos l on l.empresa_id = pr.empresa_id and l.status = 'Em aberto' and l.fidc_proposta_id is null
                and nf_parcela(coalesce(l.documento, l.descricao)) = nf_parcela(i2.documento) and abs(l.valor - i2.valor) <= 0.05
             where i2.proposta_id = p_id and i2.lancamento_id is null
               and not exists (select 1 from fidc_proposta_itens o where o.lancamento_id = l.id)
             order by i2.id, l.data) x
     where i.id = x.iid;
    select count(*) into n_sem from fidc_proposta_itens where proposta_id = p_id and lancamento_id is null;
    if n_sem > 0 then raise exception '% título(s) deste borderô ainda não estão lançados em aberto. Importe os XML das NFs (Propostas › Importar XML das NFs) e aprove de novo.', n_sem; end if;
  end if;

  select count(*), count(*) filter (where l.status = 'Em aberto' and l.fidc_proposta_id is null)
    into n_itens, n_aberto
    from fidc_proposta_itens i join lancamentos l on l.id = i.lancamento_id where i.proposta_id = p_id;
  if n_itens = 0 then raise exception 'Proposta sem títulos vinculados'; end if;
  if n_aberto <> n_itens then raise exception '% título(s) já não estão em aberto ou estão em outra proposta', n_itens - n_aberto; end if;

  select id into pl_jur from plano_contas where empresa_id = pr.empresa_id and codigo = '2.07.08';
  select id into pl_tar from plano_contas where empresa_id = pr.empresa_id and codigo = '2.07.32';
  select id into pl_rec from plano_contas where empresa_id = pr.empresa_id and codigo = '2.07.11';
  select id into pl_td  from plano_contas where empresa_id = pr.empresa_id and codigo = '3.02.01';
  select id into pl_tc  from plano_contas where empresa_id = pr.empresa_id and codigo = '3.01.01';
  select id into v_cc from centros_custo where empresa_id = pr.empresa_id and nome = 'FINANCEIRO';
  v_origem := 'fidc:proposta:' || pr.numero;
  v_rot := case when pr.origem = 'base_fidc' then format('borderô %s', coalesce(pr.comparativo->>'bordero', '')) else 'estimado' end;

  perform set_config('app.aprovando', 'sim', true);
  update lancamentos l set status = 'Pago', data = pr.data_operacao, conta_id = fu.conta_id, fidc_proposta_id = p_id
    from fidc_proposta_itens i where i.proposta_id = p_id and i.lancamento_id = l.id;

  if pl_jur is not null and pr.desagio > 0 then
    insert into lancamentos(empresa_id, data, plano_id, descricao, centro_custo_id, status, conta_id, valor, origem, fidc_proposta_id)
    values (pr.empresa_id, pr.data_operacao, pl_jur, format('%s — deságio proposta nº %s (%s)', fu.nome, pr.numero, v_rot), v_cc, 'Pago', fu.conta_id, pr.desagio, v_origem, p_id);
  end if;
  if pl_tar is not null and pr.ad_valorem + pr.tarifas + pr.iof > 0 then
    insert into lancamentos(empresa_id, data, plano_id, descricao, centro_custo_id, status, conta_id, valor, origem, fidc_proposta_id)
    values (pr.empresa_id, pr.data_operacao, pl_tar, format('%s — tarifas/IOF proposta nº %s (%s)', fu.nome, pr.numero, v_rot), v_cc, 'Pago', fu.conta_id, pr.ad_valorem + pr.tarifas + pr.iof, v_origem, p_id);
  end if;
  if pl_rec is not null and pr.recompras > 0 then
    insert into lancamentos(empresa_id, data, plano_id, descricao, centro_custo_id, status, conta_id, valor, origem, fidc_proposta_id)
    values (pr.empresa_id, pr.data_operacao, pl_rec, format('%s — recompras descontadas proposta nº %s', fu.nome, pr.numero), v_cc, 'Pago', fu.conta_id, pr.recompras, v_origem, p_id);
  end if;
  if pl_td is not null and pl_tc is not null and pr.liquido > 0 and coalesce(pr.conta_credito_id, fu.conta_credito_id) is not null then
    insert into lancamentos(empresa_id, data, plano_id, descricao, centro_custo_id, status, conta_id, valor, origem, fidc_proposta_id)
    values (pr.empresa_id, pr.data_operacao, pl_td, format('%s — líquido proposta nº %s', fu.nome, pr.numero), v_cc, 'Pago', fu.conta_id, pr.liquido, v_origem, p_id),
           (pr.empresa_id, pr.data_operacao, pl_tc, format('%s — líquido proposta nº %s', fu.nome, pr.numero), v_cc, 'Pago', coalesce(pr.conta_credito_id, fu.conta_credito_id), pr.liquido, v_origem, p_id);
  end if;

  if pr.origem = 'base_fidc' and pr.operacao_id is not null then
    v_op := pr.operacao_id;   -- o borderô já está na base FIDC
  else
    insert into fidc_operacoes(empresa_id, fundo, data, bordero, arquivo, conta_id, qtd_titulos, valor_face, desagio, ad_valorem, tarifas, iof,
                               encargos, recompra, desc_sacado, liquido, prazo_medio, prazo_cobrado, observacao)
    values (pr.empresa_id, fu.nome, pr.data_operacao, 'P' || pr.numero, 'Proposta nº ' || pr.numero || ' (plataforma)', fu.conta_id, pr.qtd_titulos,
            pr.valor_face, pr.desagio, pr.ad_valorem, pr.tarifas, pr.iof, 0, pr.recompras, 0, pr.liquido, pr.prazo_medio, pr.prazo_cobrado,
            nullif(concat_ws('; ', pr.observacao, p_motivo), ''))
    returning id into v_op;
    insert into fidc_titulos(empresa_id, operacao_id, fundo, bordero, data_operacao, titulo, vencimento, valor, cnpj_sacado, sacado, sacado_agrupado)
    select pr.empresa_id, v_op, fu.nome, 'P' || pr.numero, pr.data_operacao, i.documento, i.vencimento, i.valor, i.cnpj, i.sacado, i.sacado
      from fidc_proposta_itens i where i.proposta_id = p_id;
  end if;

  update fidc_propostas set status = 'Aprovada', motivo = p_motivo, aprovado_por = auth.uid(), aprovado_em = now(), operacao_id = v_op where id = p_id;
  return 'Aprovada';
end $$;
revoke execute on function public.decidir_proposta_fidc(uuid, boolean, text) from anon, public;
grant execute on function public.decidir_proposta_fidc(uuid, boolean, text) to authenticated;
revoke execute on function public.nf_parcela(text) from anon, public;
grant execute on function public.nf_parcela(text) to authenticated;

-- ===== 20261008000021_controle_orcamentario.sql =====
-- Controle orçamentário (08/10): realizado e comprometido por conta × centro de custo × mês,
-- rateio do orçamento da conta entre centros de custo e justificativas dos desvios. Só aditivo.

-- Lançamentos do ano agrupados por conta do plano, centro de custo, mês e status (valor sempre positivo).
-- Mesmo critério dos relatórios (lançamentos com conta bancária); tipo T (transferências) fica de fora.
create or replace function public.orcamento_movimento(p_empresa uuid, p_ano int)
returns table(plano_id uuid, centro_custo_id uuid, mes int, status text, total numeric, qtd bigint)
language sql stable set search_path = public as $$
  select l.plano_id, l.centro_custo_id, extract(month from l.data)::int, l.status, sum(l.valor), count(*)
    from lancamentos l
    join plano_contas p on p.id = l.plano_id and p.tipo in ('E','S')
    join contas ct on ct.id = l.conta_id
   where l.empresa_id = p_empresa and is_membro(p_empresa)
     and l.data between make_date(p_ano, 1, 1) and make_date(p_ano, 12, 31)
   group by 1, 2, 3, 4;
$$;
revoke execute on function public.orcamento_movimento(uuid, int) from anon, public;
grant execute on function public.orcamento_movimento(uuid, int) to authenticated;

-- Rateio do orçamento de uma conta entre centros de custo (percentual do ano). Não altera a tabela orcamentos.
create table if not exists public.orcamento_rateio_cc (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  ano int not null,
  plano_id uuid not null references public.plano_contas(id) on delete cascade,
  centro_custo_id uuid not null references public.centros_custo(id) on delete cascade,
  pct numeric(7,4) not null check (pct >= 0 and pct <= 100),
  atualizado_por uuid default auth.uid(), atualizado_em timestamptz not null default now(),
  unique (empresa_id, ano, plano_id, centro_custo_id)
);
alter table public.orcamento_rateio_cc enable row level security;
create policy orc_rateio_sel on public.orcamento_rateio_cc for select to authenticated using (public.is_membro(empresa_id));
create policy orc_rateio_ins on public.orcamento_rateio_cc for insert to authenticated with check (public.pode_editar(empresa_id));
create policy orc_rateio_upd on public.orcamento_rateio_cc for update to authenticated using (public.pode_editar(empresa_id)) with check (public.pode_editar(empresa_id));
create policy orc_rateio_del on public.orcamento_rateio_cc for delete to authenticated using (public.pode_editar(empresa_id));
grant select, insert, update, delete on public.orcamento_rateio_cc to authenticated;

-- Justificativa do desvio de uma conta (ou conta + centro de custo) em um mês
create table if not exists public.orcamento_justificativas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  ano int not null, mes smallint not null check (mes between 1 and 12),
  plano_id uuid not null references public.plano_contas(id) on delete cascade,
  centro_custo_id uuid references public.centros_custo(id) on delete cascade,
  origem text not null default 'acompanhamento' check (origem in ('acompanhamento','autorizacao')),
  orcado numeric(16,2), realizado numeric(16,2), desvio numeric(16,2),
  justificativa text not null, acao text,
  autorizacao_id uuid references public.autorizacoes(id) on delete set null,
  lancamento_id uuid references public.lancamentos(id) on delete set null,
  criado_por uuid default auth.uid(), criado_em timestamptz not null default now(), atualizado_em timestamptz not null default now()
);
create unique index if not exists orc_just_uk on public.orcamento_justificativas
  (empresa_id, ano, mes, plano_id, coalesce(centro_custo_id, '00000000-0000-0000-0000-000000000000'::uuid)) where origem = 'acompanhamento';
create index if not exists orc_just_emp on public.orcamento_justificativas(empresa_id, ano);
alter table public.orcamento_justificativas enable row level security;
create policy orc_just_sel on public.orcamento_justificativas for select to authenticated using (public.is_membro(empresa_id));
create policy orc_just_ins on public.orcamento_justificativas for insert to authenticated with check (public.pode_editar(empresa_id));
create policy orc_just_upd on public.orcamento_justificativas for update to authenticated using (public.pode_editar(empresa_id)) with check (public.pode_editar(empresa_id));
create policy orc_just_del on public.orcamento_justificativas for delete to authenticated using (public.pode_editar(empresa_id));
grant select, insert, update, delete on public.orcamento_justificativas to authenticated;

-- ===== 20261008000022_titulos_das_notas.sql =====
-- Títulos a receber gerados a partir das notas (08/10) e aprovação dos borderôs de setembro.
-- 1) nfe_vinculos aceita o tipo 'titulo': o lançamento é o próprio título a receber da parcela (nasce Em aberto e
--    continua ligado à parcela quando é baixado — borderô, conciliação ou baixa manual).
-- 2) Na aprovação de proposta vinda da base FIDC, além dos títulos Em aberto, servem também os títulos que a planilha
--    trouxe como "Pago" sem conta bancária (ex.: NFs do fim de agosto que foram para borderôs de setembro):
--    na aprovação eles recebem a data do borderô e a conta do fundo, como os demais.
alter table public.nfe_vinculos drop constraint if exists nfe_vinculos_tipo_check;
alter table public.nfe_vinculos add constraint nfe_vinculos_tipo_check check (tipo in ('exata','soma','nota','parcial','valor_diferente','manual','titulo'));

create or replace function public.decidir_proposta_fidc(p_id uuid, p_aprovar boolean, p_motivo text default null)
returns text language plpgsql security definer set search_path = public as $$
declare pr fidc_propostas; fu fidc_fundos; n_aberto int; n_itens int; n_sem int; v_origem text; v_op uuid; v_rot text;
        pl_jur uuid; pl_tar uuid; pl_rec uuid; pl_td uuid; pl_tc uuid; v_cc uuid;
begin
  select * into pr from fidc_propostas where id = p_id for update;
  if not found then raise exception 'Proposta não encontrada'; end if;
  if not is_diretor(pr.empresa_id) then raise exception 'Somente o diretor pode aprovar ou rejeitar propostas'; end if;
  if pr.status <> 'Pendente' then raise exception 'A proposta nº % não está pendente (status: %)', pr.numero, pr.status; end if;

  if not p_aprovar then
    update fidc_propostas set status = 'Rejeitada', motivo = p_motivo, aprovado_por = auth.uid(), aprovado_em = now() where id = p_id;
    return 'Rejeitada';
  end if;

  select * into fu from fidc_fundos where id = pr.fundo_id;
  if fu.conta_id is null then raise exception 'Cadastre a conta do fundo % antes de aprovar', fu.nome; end if;

  if pr.origem = 'base_fidc' then
    update fidc_proposta_itens i set lancamento_id = x.lid
      from (select distinct on (i2.id) i2.id iid, l.id lid
              from fidc_proposta_itens i2
              join lancamentos l on l.empresa_id = pr.empresa_id and l.fidc_proposta_id is null
                and (l.status = 'Em aberto' or (l.status = 'Pago' and l.conta_id is null))
                and nf_parcela(coalesce(l.documento, l.descricao)) = nf_parcela(i2.documento) and abs(l.valor - i2.valor) <= 0.05
             where i2.proposta_id = p_id and i2.lancamento_id is null
               and not exists (select 1 from fidc_proposta_itens o where o.lancamento_id = l.id)
             order by i2.id, (l.status = 'Em aberto') desc, l.data) x
     where i.id = x.iid;
    select count(*) into n_sem from fidc_proposta_itens where proposta_id = p_id and lancamento_id is null;
    if n_sem > 0 then raise exception '% título(s) deste borderô ainda não estão lançados em aberto. Gere as contas a receber das notas (Notas Fiscais › Recebimentos × Notas) e aprove de novo.', n_sem; end if;
  end if;

  select count(*), count(*) filter (where (l.status = 'Em aberto' or (pr.origem = 'base_fidc' and l.status = 'Pago' and l.conta_id is null)) and l.fidc_proposta_id is null)
    into n_itens, n_aberto
    from fidc_proposta_itens i join lancamentos l on l.id = i.lancamento_id where i.proposta_id = p_id;
  if n_itens = 0 then raise exception 'Proposta sem títulos vinculados'; end if;
  if n_aberto <> n_itens then raise exception '% título(s) já não estão em aberto ou estão em outra proposta', n_itens - n_aberto; end if;

  select id into pl_jur from plano_contas where empresa_id = pr.empresa_id and codigo = '2.07.08';
  select id into pl_tar from plano_contas where empresa_id = pr.empresa_id and codigo = '2.07.32';
  select id into pl_rec from plano_contas where empresa_id = pr.empresa_id and codigo = '2.07.11';
  select id into pl_td  from plano_contas where empresa_id = pr.empresa_id and codigo = '3.02.01';
  select id into pl_tc  from plano_contas where empresa_id = pr.empresa_id and codigo = '3.01.01';
  select id into v_cc from centros_custo where empresa_id = pr.empresa_id and nome = 'FINANCEIRO';
  v_origem := 'fidc:proposta:' || pr.numero;
  v_rot := case when pr.origem = 'base_fidc' then format('borderô %s', coalesce(pr.comparativo->>'bordero', '')) else 'estimado' end;

  perform set_config('app.aprovando', 'sim', true);
  update lancamentos l set status = 'Pago', data = pr.data_operacao, conta_id = fu.conta_id, fidc_proposta_id = p_id
    from fidc_proposta_itens i where i.proposta_id = p_id and i.lancamento_id = l.id;

  if pl_jur is not null and pr.desagio > 0 then
    insert into lancamentos(empresa_id, data, plano_id, descricao, centro_custo_id, status, conta_id, valor, origem, fidc_proposta_id)
    values (pr.empresa_id, pr.data_operacao, pl_jur, format('%s — deságio proposta nº %s (%s)', fu.nome, pr.numero, v_rot), v_cc, 'Pago', fu.conta_id, pr.desagio, v_origem, p_id);
  end if;
  if pl_tar is not null and pr.ad_valorem + pr.tarifas + pr.iof > 0 then
    insert into lancamentos(empresa_id, data, plano_id, descricao, centro_custo_id, status, conta_id, valor, origem, fidc_proposta_id)
    values (pr.empresa_id, pr.data_operacao, pl_tar, format('%s — tarifas/IOF proposta nº %s (%s)', fu.nome, pr.numero, v_rot), v_cc, 'Pago', fu.conta_id, pr.ad_valorem + pr.tarifas + pr.iof, v_origem, p_id);
  end if;
  if pl_rec is not null and pr.recompras > 0 then
    insert into lancamentos(empresa_id, data, plano_id, descricao, centro_custo_id, status, conta_id, valor, origem, fidc_proposta_id)
    values (pr.empresa_id, pr.data_operacao, pl_rec, format('%s — recompras descontadas proposta nº %s', fu.nome, pr.numero), v_cc, 'Pago', fu.conta_id, pr.recompras, v_origem, p_id);
  end if;
  if pl_td is not null and pl_tc is not null and pr.liquido > 0 and coalesce(pr.conta_credito_id, fu.conta_credito_id) is not null then
    insert into lancamentos(empresa_id, data, plano_id, descricao, centro_custo_id, status, conta_id, valor, origem, fidc_proposta_id)
    values (pr.empresa_id, pr.data_operacao, pl_td, format('%s — líquido proposta nº %s', fu.nome, pr.numero), v_cc, 'Pago', fu.conta_id, pr.liquido, v_origem, p_id),
           (pr.empresa_id, pr.data_operacao, pl_tc, format('%s — líquido proposta nº %s', fu.nome, pr.numero), v_cc, 'Pago', coalesce(pr.conta_credito_id, fu.conta_credito_id), pr.liquido, v_origem, p_id);
  end if;

  if pr.origem = 'base_fidc' and pr.operacao_id is not null then
    v_op := pr.operacao_id;
  else
    insert into fidc_operacoes(empresa_id, fundo, data, bordero, arquivo, conta_id, qtd_titulos, valor_face, desagio, ad_valorem, tarifas, iof,
                               encargos, recompra, desc_sacado, liquido, prazo_medio, prazo_cobrado, observacao)
    values (pr.empresa_id, fu.nome, pr.data_operacao, 'P' || pr.numero, 'Proposta nº ' || pr.numero || ' (plataforma)', fu.conta_id, pr.qtd_titulos,
            pr.valor_face, pr.desagio, pr.ad_valorem, pr.tarifas, pr.iof, 0, pr.recompras, 0, pr.liquido, pr.prazo_medio, pr.prazo_cobrado,
            nullif(concat_ws('; ', pr.observacao, p_motivo), ''))
    returning id into v_op;
    insert into fidc_titulos(empresa_id, operacao_id, fundo, bordero, data_operacao, titulo, vencimento, valor, cnpj_sacado, sacado, sacado_agrupado)
    select pr.empresa_id, v_op, fu.nome, 'P' || pr.numero, pr.data_operacao, i.documento, i.vencimento, i.valor, i.cnpj, i.sacado, i.sacado
      from fidc_proposta_itens i where i.proposta_id = p_id;
  end if;

  update fidc_propostas set status = 'Aprovada', motivo = p_motivo, aprovado_por = auth.uid(), aprovado_em = now(), operacao_id = v_op where id = p_id;
  return 'Aprovada';
end $$;
revoke execute on function public.decidir_proposta_fidc(uuid, boolean, text) from anon, public;
grant execute on function public.decidir_proposta_fidc(uuid, boolean, text) to authenticated;

-- ===== 20261008000023_aprovacao_interna.sql =====
-- Aprovação separada em função interna (sem checar quem aprova), usada pela decidir_proposta_fidc (diretor)
-- e por aprovações registradas pelo administrador fora da tela (ex.: borderôs de setembro, autorizados pelo Renan em 08/10).
create or replace function public._aprovar_proposta_fidc(p_id uuid, p_motivo text, p_aprovador uuid)
returns text language plpgsql security definer set search_path = public as $$
declare pr fidc_propostas; fu fidc_fundos; n_aberto int; n_itens int; n_sem int; v_origem text; v_op uuid; v_rot text;
        pl_jur uuid; pl_tar uuid; pl_rec uuid; pl_td uuid; pl_tc uuid; v_cc uuid;
begin
  select * into pr from fidc_propostas where id = p_id for update;
  if not found then raise exception 'Proposta não encontrada'; end if;
  if pr.status <> 'Pendente' then raise exception 'A proposta nº % não está pendente (status: %)', pr.numero, pr.status; end if;
  select * into fu from fidc_fundos where id = pr.fundo_id;
  if fu.conta_id is null then raise exception 'Cadastre a conta do fundo % antes de aprovar', fu.nome; end if;

  if pr.origem = 'base_fidc' then
    update fidc_proposta_itens i set lancamento_id = x.lid
      from (select distinct on (i2.id) i2.id iid, l.id lid
              from fidc_proposta_itens i2
              join lancamentos l on l.empresa_id = pr.empresa_id and l.fidc_proposta_id is null
                and (l.status = 'Em aberto' or (l.status = 'Pago' and l.conta_id is null))
                and nf_parcela(coalesce(l.documento, l.descricao)) = nf_parcela(i2.documento) and abs(l.valor - i2.valor) <= 0.05
             where i2.proposta_id = p_id and i2.lancamento_id is null
               and not exists (select 1 from fidc_proposta_itens o where o.lancamento_id = l.id)
             order by i2.id, (l.status = 'Em aberto') desc, l.data) x
     where i.id = x.iid;
    select count(*) into n_sem from fidc_proposta_itens where proposta_id = p_id and lancamento_id is null;
    if n_sem > 0 then raise exception '% título(s) deste borderô ainda não estão lançados em aberto. Gere as contas a receber das notas (Notas Fiscais › Recebimentos × Notas) e aprove de novo.', n_sem; end if;
  end if;

  select count(*), count(*) filter (where (l.status = 'Em aberto' or (pr.origem = 'base_fidc' and l.status = 'Pago' and l.conta_id is null)) and l.fidc_proposta_id is null)
    into n_itens, n_aberto
    from fidc_proposta_itens i join lancamentos l on l.id = i.lancamento_id where i.proposta_id = p_id;
  if n_itens = 0 then raise exception 'Proposta sem títulos vinculados'; end if;
  if n_aberto <> n_itens then raise exception '% título(s) já não estão em aberto ou estão em outra proposta', n_itens - n_aberto; end if;

  select id into pl_jur from plano_contas where empresa_id = pr.empresa_id and codigo = '2.07.08';
  select id into pl_tar from plano_contas where empresa_id = pr.empresa_id and codigo = '2.07.32';
  select id into pl_rec from plano_contas where empresa_id = pr.empresa_id and codigo = '2.07.11';
  select id into pl_td  from plano_contas where empresa_id = pr.empresa_id and codigo = '3.02.01';
  select id into pl_tc  from plano_contas where empresa_id = pr.empresa_id and codigo = '3.01.01';
  select id into v_cc from centros_custo where empresa_id = pr.empresa_id and nome = 'FINANCEIRO';
  v_origem := 'fidc:proposta:' || pr.numero;
  v_rot := case when pr.origem = 'base_fidc' then format('borderô %s', coalesce(pr.comparativo->>'bordero', '')) else 'estimado' end;

  perform set_config('app.aprovando', 'sim', true);
  update lancamentos l set status = 'Pago', data = pr.data_operacao, conta_id = fu.conta_id, fidc_proposta_id = p_id
    from fidc_proposta_itens i where i.proposta_id = p_id and i.lancamento_id = l.id;

  if pl_jur is not null and pr.desagio > 0 then
    insert into lancamentos(empresa_id, data, plano_id, descricao, centro_custo_id, status, conta_id, valor, origem, fidc_proposta_id)
    values (pr.empresa_id, pr.data_operacao, pl_jur, format('%s — deságio proposta nº %s (%s)', fu.nome, pr.numero, v_rot), v_cc, 'Pago', fu.conta_id, pr.desagio, v_origem, p_id);
  end if;
  if pl_tar is not null and pr.ad_valorem + pr.tarifas + pr.iof > 0 then
    insert into lancamentos(empresa_id, data, plano_id, descricao, centro_custo_id, status, conta_id, valor, origem, fidc_proposta_id)
    values (pr.empresa_id, pr.data_operacao, pl_tar, format('%s — tarifas/IOF proposta nº %s (%s)', fu.nome, pr.numero, v_rot), v_cc, 'Pago', fu.conta_id, pr.ad_valorem + pr.tarifas + pr.iof, v_origem, p_id);
  end if;
  if pl_rec is not null and pr.recompras > 0 then
    insert into lancamentos(empresa_id, data, plano_id, descricao, centro_custo_id, status, conta_id, valor, origem, fidc_proposta_id)
    values (pr.empresa_id, pr.data_operacao, pl_rec, format('%s — recompras descontadas proposta nº %s', fu.nome, pr.numero), v_cc, 'Pago', fu.conta_id, pr.recompras, v_origem, p_id);
  end if;
  if pl_td is not null and pl_tc is not null and pr.liquido > 0 and coalesce(pr.conta_credito_id, fu.conta_credito_id) is not null then
    insert into lancamentos(empresa_id, data, plano_id, descricao, centro_custo_id, status, conta_id, valor, origem, fidc_proposta_id)
    values (pr.empresa_id, pr.data_operacao, pl_td, format('%s — líquido proposta nº %s', fu.nome, pr.numero), v_cc, 'Pago', fu.conta_id, pr.liquido, v_origem, p_id),
           (pr.empresa_id, pr.data_operacao, pl_tc, format('%s — líquido proposta nº %s', fu.nome, pr.numero), v_cc, 'Pago', coalesce(pr.conta_credito_id, fu.conta_credito_id), pr.liquido, v_origem, p_id);
  end if;

  if pr.origem = 'base_fidc' and pr.operacao_id is not null then
    v_op := pr.operacao_id;
  else
    insert into fidc_operacoes(empresa_id, fundo, data, bordero, arquivo, conta_id, qtd_titulos, valor_face, desagio, ad_valorem, tarifas, iof,
                               encargos, recompra, desc_sacado, liquido, prazo_medio, prazo_cobrado, observacao)
    values (pr.empresa_id, fu.nome, pr.data_operacao, 'P' || pr.numero, 'Proposta nº ' || pr.numero || ' (plataforma)', fu.conta_id, pr.qtd_titulos,
            pr.valor_face, pr.desagio, pr.ad_valorem, pr.tarifas, pr.iof, 0, pr.recompras, 0, pr.liquido, pr.prazo_medio, pr.prazo_cobrado,
            nullif(concat_ws('; ', pr.observacao, p_motivo), ''))
    returning id into v_op;
    insert into fidc_titulos(empresa_id, operacao_id, fundo, bordero, data_operacao, titulo, vencimento, valor, cnpj_sacado, sacado, sacado_agrupado)
    select pr.empresa_id, v_op, fu.nome, 'P' || pr.numero, pr.data_operacao, i.documento, i.vencimento, i.valor, i.cnpj, i.sacado, i.sacado
      from fidc_proposta_itens i where i.proposta_id = p_id;
  end if;

  update fidc_propostas set status = 'Aprovada', motivo = p_motivo, aprovado_por = p_aprovador, aprovado_em = now(), operacao_id = v_op where id = p_id;
  return 'Aprovada';
end $$;
revoke execute on function public._aprovar_proposta_fidc(uuid, text, uuid) from anon, authenticated, public;

create or replace function public.decidir_proposta_fidc(p_id uuid, p_aprovar boolean, p_motivo text default null)
returns text language plpgsql security definer set search_path = public as $$
declare pr fidc_propostas;
begin
  select * into pr from fidc_propostas where id = p_id for update;
  if not found then raise exception 'Proposta não encontrada'; end if;
  if not is_diretor(pr.empresa_id) then raise exception 'Somente o diretor pode aprovar ou rejeitar propostas'; end if;
  if pr.status <> 'Pendente' then raise exception 'A proposta nº % não está pendente (status: %)', pr.numero, pr.status; end if;
  if not p_aprovar then
    update fidc_propostas set status = 'Rejeitada', motivo = p_motivo, aprovado_por = auth.uid(), aprovado_em = now() where id = p_id;
    return 'Rejeitada';
  end if;
  return _aprovar_proposta_fidc(p_id, p_motivo, auth.uid());
end $$;
revoke execute on function public.decidir_proposta_fidc(uuid, boolean, text) from anon, public;
grant execute on function public.decidir_proposta_fidc(uuid, boolean, text) to authenticated;

-- ===== 20261009000025_travas_contas.sql =====
-- Trava de contas (09/10): depois que o banco bate com o extrato, o administrador trava a conta até uma data.
-- Lançamentos pagos da conta com data até a trava não podem mudar data, valor, conta nem situação, nem ser excluídos
-- ou incluídos; continuam livres classificação (mesma natureza), descrição, documento, centro de custo e favorecido.
-- Conciliações e itens de extrato do período também ficam travados. Destravar guarda quem e quando (histórico).
create table if not exists public.contas_travas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  conta_id uuid not null references public.contas(id) on delete cascade,
  ate date not null,
  saldo_sistema numeric(16,2), saldo_banco numeric(16,2),
  observacao text,
  ativo boolean not null default true,
  criado_por uuid default auth.uid(), criado_em timestamptz not null default now(),
  desfeito_por uuid, desfeito_em timestamptz
);
create unique index if not exists contas_travas_ativa on public.contas_travas(conta_id) where ativo;
create index if not exists contas_travas_emp on public.contas_travas(empresa_id, conta_id, criado_em desc);

alter table public.contas_travas enable row level security;
drop policy if exists contas_travas_sel on public.contas_travas;
drop policy if exists contas_travas_ins on public.contas_travas;
drop policy if exists contas_travas_upd on public.contas_travas;
create policy contas_travas_sel on public.contas_travas for select to authenticated using (public.is_membro(empresa_id));
create policy contas_travas_ins on public.contas_travas for insert to authenticated with check (public.is_admin(empresa_id));
create policy contas_travas_upd on public.contas_travas for update to authenticated using (public.is_admin(empresa_id)) with check (public.is_admin(empresa_id));
grant select, insert, update on public.contas_travas to authenticated;

create or replace function public.trava_ate(p_conta uuid) returns date
language sql stable security definer set search_path = public as $$
  select ate from contas_travas where conta_id = p_conta and ativo
$$;
grant execute on function public.trava_ate(uuid) to authenticated;

create or replace function public._trava_lancamentos() returns trigger
language plpgsql security definer set search_path = public as $$
declare t_old date; t_new date; nat_old text; nat_new text; nm text;
begin
  if tg_op in ('UPDATE', 'DELETE') and old.conta_id is not null and old.status = 'Pago' then t_old := trava_ate(old.conta_id); end if;
  if tg_op in ('INSERT', 'UPDATE') and new.conta_id is not null and new.status = 'Pago' then t_new := trava_ate(new.conta_id); end if;
  if tg_op = 'DELETE' then
    if t_old is not null and old.data <= t_old then
      select nome into nm from contas where id = old.conta_id;
      raise exception 'A conta % está travada até %: não é possível excluir o lançamento de %.', nm, to_char(t_old, 'DD/MM/YYYY'), to_char(old.data, 'DD/MM/YYYY');
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' and t_old is not null and old.data <= t_old then
    if new.data is distinct from old.data or new.valor is distinct from old.valor or new.conta_id is distinct from old.conta_id or new.status is distinct from old.status then
      select nome into nm from contas where id = old.conta_id;
      raise exception 'A conta % está travada até %: data, valor, conta e situação dos lançamentos até essa data não podem mudar (classificação, descrição e centro de custo podem).', nm, to_char(t_old, 'DD/MM/YYYY');
    end if;
    if new.plano_id is distinct from old.plano_id then
      select natureza into nat_old from plano_contas where id = old.plano_id;
      select natureza into nat_new from plano_contas where id = new.plano_id;
      if nat_old is distinct from nat_new then
        select nome into nm from contas where id = old.conta_id;
        raise exception 'A conta % está travada até %: a nova classificação é de natureza diferente (entrada × saída) e mudaria o saldo.', nm, to_char(t_old, 'DD/MM/YYYY');
      end if;
    end if;
    return new;
  end if;
  if t_new is not null and new.data <= t_new then
    select nome into nm from contas where id = new.conta_id;
    raise exception 'A conta % está travada até %: não é possível lançar ou baixar lançamento com data de % nela.', nm, to_char(t_new, 'DD/MM/YYYY'), to_char(new.data, 'DD/MM/YYYY');
  end if;
  return new;
end $$;
drop trigger if exists trava_lancamentos on public.lancamentos;
create trigger trava_lancamentos before insert or update or delete on public.lancamentos for each row execute function public._trava_lancamentos();

-- extrato e conciliação do período travado
create or replace function public._trava_extrato() returns trigger
language plpgsql security definer set search_path = public as $$
declare t date; d date; c uuid; nm text;
begin
  if tg_table_name = 'conciliacoes' then
    select e.data, e.conta_id into d, c from extrato_itens e where e.id = coalesce(new.extrato_id, old.extrato_id);
  else
    d := old.data; c := old.conta_id;
    if tg_op = 'UPDATE' and new.status is not distinct from old.status and new.grupo_id is not distinct from old.grupo_id then return new; end if;
  end if;
  t := trava_ate(c);
  if t is not null and d <= t then
    select nome into nm from contas where id = c;
    raise exception 'A conta % está travada até %: a conciliação e o extrato desse período não podem ser alterados.', nm, to_char(t, 'DD/MM/YYYY');
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
drop trigger if exists trava_conciliacoes on public.conciliacoes;
create trigger trava_conciliacoes before insert or delete on public.conciliacoes for each row execute function public._trava_extrato();
drop trigger if exists trava_extrato_itens on public.extrato_itens;
create trigger trava_extrato_itens before update or delete on public.extrato_itens for each row execute function public._trava_extrato();

-- ===== 20261009000026_creditos_adiantamentos.sql =====
-- Créditos e adiantamentos (09/10).
-- creditos: valor que o cliente tem a abater (adiantamento recebido antes da nota, crédito por devolução, desconto,
--           acordo) ou que a IPLAMM tem a abater com um fornecedor (adiantamento pago antes da nota de entrada).
-- creditos_usos: aplicação do crédito numa parcela de nota — a parcela conta como recebida/paga nesse valor,
--           sem movimento de caixa (o caixa entrou ou saiu quando o adiantamento foi recebido/pago).
-- Aditivo: não altera dados existentes.
create table if not exists public.creditos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  favorecido_id uuid not null references public.favorecidos(id),
  natureza text not null check (natureza in ('cliente', 'fornecedor')),
  tipo text not null check (tipo in ('adiantamento', 'devolucao', 'desconto', 'acordo', 'outro')),
  data date not null,
  valor numeric(16,2) not null check (valor > 0),
  descricao text,
  lancamento_id uuid references public.lancamentos(id) on delete set null,   -- recebimento/pagamento do adiantamento
  nota_id uuid references public.nfe_notas(id) on delete set null,           -- nota de devolução que gerou o crédito
  cancelado boolean not null default false,
  criado_por uuid default auth.uid(), criado_em timestamptz not null default now()
);
create index if not exists creditos_fav on public.creditos(empresa_id, favorecido_id);

create table if not exists public.creditos_usos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  credito_id uuid not null references public.creditos(id) on delete cascade,
  nota_id uuid not null references public.nfe_notas(id) on delete cascade,
  parcela_id uuid references public.nfe_parcelas(id) on delete cascade,
  data date not null,
  valor numeric(16,2) not null check (valor > 0),
  observacao text,
  criado_por uuid default auth.uid(), criado_em timestamptz not null default now()
);
create index if not exists creditos_usos_credito on public.creditos_usos(credito_id);
create index if not exists creditos_usos_nota on public.creditos_usos(nota_id);

-- o total usado não pode passar do valor do crédito
create or replace function public._creditos_usos_limite() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_cred numeric; v_usado numeric; v_canc boolean;
begin
  select valor, cancelado into v_cred, v_canc from creditos where id = new.credito_id for update;
  if v_canc then raise exception 'Este crédito está cancelado.'; end if;
  select coalesce(sum(valor), 0) into v_usado from creditos_usos where credito_id = new.credito_id and id <> new.id;
  if v_usado + new.valor > v_cred + 0.005 then
    raise exception 'O crédito tem saldo de R$ %, menor que o valor usado (R$ %).', to_char(v_cred - v_usado, 'FM999G999G990D00'), to_char(new.valor, 'FM999G999G990D00');
  end if;
  return new;
end $$;
drop trigger if exists creditos_usos_limite on public.creditos_usos;
create trigger creditos_usos_limite before insert or update on public.creditos_usos for each row execute function public._creditos_usos_limite();

alter table public.creditos enable row level security;
alter table public.creditos_usos enable row level security;
drop policy if exists creditos_sel on public.creditos;
drop policy if exists creditos_ins on public.creditos;
drop policy if exists creditos_upd on public.creditos;
drop policy if exists creditos_del on public.creditos;
create policy creditos_sel on public.creditos for select to authenticated using (public.is_membro(empresa_id));
create policy creditos_ins on public.creditos for insert to authenticated with check (public.pode_editar(empresa_id));
create policy creditos_upd on public.creditos for update to authenticated using (public.pode_editar(empresa_id)) with check (public.pode_editar(empresa_id));
create policy creditos_del on public.creditos for delete to authenticated using (public.pode_editar(empresa_id));
drop policy if exists creditos_usos_sel on public.creditos_usos;
drop policy if exists creditos_usos_ins on public.creditos_usos;
drop policy if exists creditos_usos_del on public.creditos_usos;
create policy creditos_usos_sel on public.creditos_usos for select to authenticated using (public.is_membro(empresa_id));
create policy creditos_usos_ins on public.creditos_usos for insert to authenticated with check (public.pode_editar(empresa_id));
create policy creditos_usos_del on public.creditos_usos for delete to authenticated using (public.pode_editar(empresa_id));
grant select, insert, update, delete on public.creditos to authenticated;
grant select, insert, delete on public.creditos_usos to authenticated;

-- ===== 20261012000027_paraquedas.sql =====
-- =====================================================================
-- Paraquedas: pagamentos pedidos antes da nota fiscal (adiantamentos, compras do dia)
--  - qualquer usuário da empresa (inclusive o novo papel "compras") lança o pedido
--  - a direção (admin/diretor) aprova ou rejeita
--  - o financeiro gera o lançamento "Em aberto" no fluxo do dia; depois de pago vira adiantamento
--    ao fornecedor e, quando a nota chega, a nota abate o adiantamento
-- Papel "compras": só vê e lança os próprios paraquedas; não enxerga saldos, lançamentos nem cadastros.
-- =====================================================================

-- 1) papel novo
alter type public.papel_membro add value if not exists 'compras';

-- 2) "membro" deixa de incluir compras (todas as leituras da plataforma usam is_membro)
create or replace function public.is_membro(p_empresa uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from membros where empresa_id = p_empresa and user_id = auth.uid() and papel::text <> 'compras');
$$;

-- qualquer usuário ligado à empresa, inclusive compras
create or replace function public.is_participante(p_empresa uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from membros where empresa_id = p_empresa and user_id = auth.uid());
$$;

create or replace function public.pode_aprovar_paraquedas(p_empresa uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from membros where empresa_id = p_empresa and user_id = auth.uid() and papel::text in ('admin', 'diretor'));
$$;

-- o usuário de compras precisa ler a própria linha de membro e a empresa para entrar na plataforma
drop policy if exists membros_sel_proprio on public.membros;
create policy membros_sel_proprio on public.membros for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists empresas_sel_participante on public.empresas;
create policy empresas_sel_participante on public.empresas for select to authenticated using (public.is_participante(id));

-- 3) tabela
create table if not exists public.paraquedas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  numero int not null default 0,
  solicitante text,
  -- quem recebe
  razao_social text not null,
  cnpj text,                                   -- CNPJ ou CPF, só dígitos
  favorecido_id uuid references public.favorecidos(id) on delete set null,
  pix_tipo text check (pix_tipo in ('cnpj', 'cpf', 'email', 'telefone', 'aleatoria')),
  pix_chave text,
  banco text, agencia text, conta_bancaria text,
  -- o pedido
  valor numeric(16,2) not null check (valor > 0),
  data_pagamento date not null,
  descricao text not null,
  pedido text,
  tera_nota boolean not null default true,
  previsao_nota date,
  prioridade text not null default 'normal' check (prioridade in ('normal', 'urgente')),
  anexo_url text,
  -- classificação (financeiro)
  plano_id uuid references public.plano_contas(id) on delete set null,
  centro_custo_id uuid references public.centros_custo(id) on delete set null,
  conta_id uuid references public.contas(id) on delete set null,
  -- andamento
  status text not null default 'aguardando' check (status in ('aguardando', 'aprovado', 'rejeitado', 'cancelado', 'pago', 'nota_recebida')),
  motivo text,                                  -- motivo da rejeição / cancelamento
  aprovado_por uuid references auth.users(id),
  aprovado_em timestamptz,
  lancamento_id uuid references public.lancamentos(id) on delete set null,
  credito_id uuid references public.creditos(id) on delete set null,
  nota_id uuid references public.nfe_notas(id) on delete set null,
  criado_por uuid default auth.uid(),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists paraquedas_emp_status on public.paraquedas(empresa_id, status, data_pagamento);
create index if not exists paraquedas_criado_por on public.paraquedas(criado_por);

-- número sequencial por empresa, quem aprovou/quando, e quem pode mudar o quê
create or replace function public._paraquedas_regras() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    select coalesce(max(numero), 0) + 1 into new.numero from paraquedas where empresa_id = new.empresa_id;
    new.status := 'aguardando'; new.aprovado_por := null; new.aprovado_em := null;
    new.criado_por := auth.uid(); new.cnpj := nullif(regexp_replace(coalesce(new.cnpj, ''), '\D', '', 'g'), '');
    return new;
  end if;
  new.atualizado_em := now(); new.numero := old.numero; new.criado_por := old.criado_por;
  new.cnpj := nullif(regexp_replace(coalesce(new.cnpj, ''), '\D', '', 'g'), '');
  if new.status is distinct from old.status then
    if new.status in ('aprovado', 'rejeitado') and old.status = 'aguardando' then
      if not pode_aprovar_paraquedas(new.empresa_id) then raise exception 'Só a direção (administrador ou diretor) aprova paraquedas.'; end if;
      new.aprovado_por := auth.uid(); new.aprovado_em := now();
    elsif new.status = 'aguardando' and old.status = 'rejeitado' then
      new.aprovado_por := null; new.aprovado_em := null;     -- reenviado depois de corrigido
    elsif new.status = 'cancelado' then
      if old.status in ('pago', 'nota_recebida') then raise exception 'Paraquedas já pago não pode ser cancelado.'; end if;
    elsif new.status in ('pago', 'nota_recebida') and old.status in ('aprovado', 'pago') then
      null;
    else
      raise exception 'Mudança de situação não permitida: % → %', old.status, new.status;
    end if;
  end if;
  -- depois de aprovado, valor e recebedor só mudam voltando para aprovação
  if old.status <> 'aguardando' and old.status <> 'rejeitado' and new.status not in ('aguardando')
     and (new.valor is distinct from old.valor or new.razao_social is distinct from old.razao_social or new.cnpj is distinct from old.cnpj
          or new.pix_chave is distinct from old.pix_chave or new.conta_bancaria is distinct from old.conta_bancaria) then
    raise exception 'Paraquedas já aprovado: valor e dados de quem recebe não podem mudar. Cancele e lance outro.';
  end if;
  return new;
end $$;
drop trigger if exists paraquedas_regras on public.paraquedas;
create trigger paraquedas_regras before insert or update on public.paraquedas for each row execute function public._paraquedas_regras();

-- 4) acesso
alter table public.paraquedas enable row level security;
drop policy if exists paraquedas_sel on public.paraquedas;
drop policy if exists paraquedas_ins on public.paraquedas;
drop policy if exists paraquedas_upd on public.paraquedas;
-- membros (não compras) veem todos; compras vê só os próprios
create policy paraquedas_sel on public.paraquedas for select to authenticated
  using (public.is_membro(empresa_id) or (public.is_participante(empresa_id) and criado_por = (select auth.uid())));
create policy paraquedas_ins on public.paraquedas for insert to authenticated
  with check (public.is_participante(empresa_id) and not exists (select 1 from membros m where m.empresa_id = paraquedas.empresa_id and m.user_id = auth.uid() and m.papel::text = 'leitura'));
-- financeiro/direção atualizam; o autor corrige/cancela o próprio enquanto aguarda ou foi rejeitado
create policy paraquedas_upd on public.paraquedas for update to authenticated
  using (public.pode_editar(empresa_id) or public.pode_aprovar_paraquedas(empresa_id)
         or (public.is_participante(empresa_id) and criado_por = (select auth.uid()) and status in ('aguardando', 'rejeitado')))
  with check (public.pode_editar(empresa_id) or public.pode_aprovar_paraquedas(empresa_id)
         or (public.is_participante(empresa_id) and criado_por = (select auth.uid()) and status in ('aguardando', 'cancelado')));

-- 20261013000028_convites.sql
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

-- 20261013000029_convite_encerra_pendente.sql
-- criar_convite: quando a pessoa já tem conta e entra direto na empresa,
-- encerra qualquer convite pendente dela nesta empresa (senão o convite antigo
-- poderia trocar o papel no primeiro login).
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
    update convites set cancelado_em = now()
     where empresa_id = p_empresa and lower(email) = v_email and aceito_em is null and cancelado_em is null;
    return json_build_object('tipo', 'membro');
  end if;
  update convites set papel = p_papel, expira_em = now() + interval '14 days', criado_por = auth.uid(), criado_em = now()
   where empresa_id = p_empresa and lower(email) = v_email and aceito_em is null and cancelado_em is null
  returning token into v_token;
  if v_token is null then
    insert into convites(empresa_id, email, papel) values (p_empresa, v_email, p_papel) returning token into v_token;
  end if;
  return json_build_object('tipo', 'convite', 'token', v_token);
-- =====================================================================
-- Conferência do dia: o "visto" de quem conferiu cada conta em cada dia
--  - um registro por conta e dia (dar visto de novo atualiza o registro)
--  - situacao: 'ok' (conferido, tudo certo) ou 'ressalva' (conferido, com pendência explicada na observação)
--  - saldo_informado: para conta sem extrato OFX (caixa, cartão, vale…), o saldo real conferido no dia
-- Só lê/grava o visto: nenhum lançamento é alterado por esta tabela.
-- =====================================================================
create table if not exists public.conferencias_dia (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  conta_id uuid not null references public.contas(id) on delete cascade,
  data date not null,
  situacao text not null default 'ok' check (situacao in ('ok', 'ressalva')),
  saldo_sistema numeric(16,2),
  saldo_informado numeric(16,2),
  observacao text,
  conferido_por uuid default auth.uid(),
  conferido_email text default (auth.jwt() ->> 'email'),
  conferido_em timestamptz not null default now(),
  unique (conta_id, data)
);
create index if not exists conferencias_dia_emp on public.conferencias_dia(empresa_id, data);

-- quem gravou e quando é sempre o usuário logado (não dá para assinar em nome de outro)
create or replace function public._conferencias_dia_autor() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.conferido_por := auth.uid();
  new.conferido_email := auth.jwt() ->> 'email';
  new.conferido_em := now();
  return new;
end $$;
drop trigger if exists conferencias_dia_autor on public.conferencias_dia;
create trigger conferencias_dia_autor before insert or update on public.conferencias_dia
  for each row execute function public._conferencias_dia_autor();

alter table public.conferencias_dia enable row level security;
drop policy if exists conferencias_dia_sel on public.conferencias_dia;
drop policy if exists conferencias_dia_ins on public.conferencias_dia;
drop policy if exists conferencias_dia_upd on public.conferencias_dia;
drop policy if exists conferencias_dia_del on public.conferencias_dia;
create policy conferencias_dia_sel on public.conferencias_dia for select to authenticated using (public.is_membro(empresa_id));
create policy conferencias_dia_ins on public.conferencias_dia for insert to authenticated with check (public.pode_editar(empresa_id));
create policy conferencias_dia_upd on public.conferencias_dia for update to authenticated using (public.pode_editar(empresa_id)) with check (public.pode_editar(empresa_id));
create policy conferencias_dia_del on public.conferencias_dia for delete to authenticated using (public.pode_editar(empresa_id));
grant select, insert, update, delete on public.conferencias_dia to authenticated;

-- =====================================================================
-- Transferência em um único lançamento
--  - o lançamento de transferência passa a ter conta de ORIGEM (conta_id) e conta de DESTINO (conta_destino_id)
--  - usa o plano de saída (3.02.xx): na origem conta como saída; no destino, como entrada no plano de contrapartida (3.01.xx)
--  - todos os cálculos (saldos, fluxo mensal/diário, DRE, saldo de abertura) passam a contar as duas pontas
--  - a conciliação aceita uma linha de extrato em cada conta para o mesmo lançamento
--  - a trava vale para as duas contas
-- Enquanto nenhum lançamento tiver conta de destino, NADA muda nos números: as transferências antigas (duas pontas)
-- continuam funcionando como hoje.
-- =====================================================================

-- 1) coluna nova
alter table public.lancamentos add column if not exists conta_destino_id uuid references public.contas(id) on delete restrict;
alter table public.lancamentos drop constraint if exists lanc_destino_diferente;
alter table public.lancamentos add constraint lanc_destino_diferente check (conta_destino_id is null or conta_destino_id <> conta_id);
create index if not exists lancamentos_destino on public.lancamentos(conta_destino_id, data) where conta_destino_id is not null;

-- 2) plano de contrapartida: 3.02.xx (saída) ↔ 3.01.xx (entrada), pelo final do código
alter table public.plano_contas add column if not exists contrapartida_id uuid references public.plano_contas(id) on delete set null;
update public.plano_contas d set contrapartida_id = c.id
  from public.plano_contas c
 where d.tipo = 'T' and c.tipo = 'T' and c.empresa_id = d.empresa_id and d.nivel = 2 and c.nivel = 2
   and d.natureza <> c.natureza and split_part(d.codigo, '.', 3) = split_part(c.codigo, '.', 3)
   and split_part(d.codigo, '.', 3) <> '' and d.contrapartida_id is null;

-- 3) pontas: cada lançamento é uma ponta na sua conta; a transferência única gera a segunda ponta no destino
create or replace view public.v_lanc_pontas with (security_invoker = on) as
  select l.id, l.empresa_id, l.data, l.status, l.conta_id, l.plano_id, l.centro_custo_id, l.favorecido_id,
         case when p.natureza = 'C' then l.valor else -l.valor end as valor_sinal, false as destino
    from public.lancamentos l join public.plano_contas p on p.id = l.plano_id
  union all
  select l.id, l.empresa_id, l.data, l.status, l.conta_destino_id, coalesce(p.contrapartida_id, l.plano_id), l.centro_custo_id, l.favorecido_id,
         l.valor, true
    from public.lancamentos l join public.plano_contas p on p.id = l.plano_id
   where l.conta_destino_id is not null;
grant select on public.v_lanc_pontas to authenticated;

-- 4) base de todos os relatórios (resumo_mensal, resumo_diario, saldo_em): agora pelas pontas
create or replace function public._lanc_filtrados(p_empresa uuid, p_de date, p_ate date, p_status text[], p_conta uuid, p_grupo uuid, p_cc uuid, p_favorecido uuid, p_disp text)
returns table(id uuid, data date, plano_id uuid, classe_id uuid, valor_sinal numeric, status text, conta_id uuid)
language sql stable set search_path = public as $$
  select v.id, v.data, v.plano_id, p.pai_id, v.valor_sinal, v.status, v.conta_id
  from v_lanc_pontas v
  join plano_contas p on p.id = v.plano_id
  join contas ct on ct.id = v.conta_id
  where v.empresa_id = p_empresa
    and is_membro(p_empresa)
    and v.data between p_de and p_ate
    and v.status = any(p_status)
    and (p_conta is null or v.conta_id = p_conta)
    and (p_grupo is null or ct.grupo_id = p_grupo)
    and (p_cc is null or v.centro_custo_id = p_cc)
    and (p_favorecido is null or v.favorecido_id = p_favorecido)
    and (p_disp is null or ct.disponibilidade = p_disp);
$$;

-- 5) saldos por conta: pelas pontas
create or replace function public.saldos_contas(p_empresa uuid, p_ate date default current_date)
returns table(conta_id uuid, nome text, grupo text, disponibilidade text, saldo_pago numeric, a_receber numeric, a_pagar numeric)
language sql stable set search_path = public as $$
  select ct.id, ct.nome, g.nome, ct.disponibilidade,
         ct.saldo_inicial + coalesce(sum(case when v.status = 'Pago' and v.data <= p_ate then v.valor_sinal end), 0),
         coalesce(sum(case when v.status = 'Em aberto' and v.valor_sinal > 0 then v.valor_sinal end), 0),
         coalesce(sum(case when v.status = 'Em aberto' and v.valor_sinal < 0 then -v.valor_sinal end), 0)
  from contas ct
  left join grupos g on g.id = ct.grupo_id
  left join v_lanc_pontas v on v.conta_id = ct.id
  where ct.empresa_id = p_empresa and is_membro(p_empresa) and ct.ativo
  group by ct.id, ct.nome, g.nome, ct.disponibilidade, ct.saldo_inicial
  order by ct.codigo nulls last, ct.nome;
$$;

-- 6) lista de lançamentos: mostra também a conta de destino (colunas novas no fim)
create or replace view public.v_lancamentos with (security_invoker = on) as
 SELECT l.id, l.empresa_id, l.data, l.plano_id, l.descricao, l.opc1, l.opc2, l.opc3, l.opc4, l.favorecido_id, l.centro_custo_id,
    l.status, l.conta_id, l.valor, l.prioridade, l.origem, l.created_by, l.created_at, l.updated_at,
    (EXTRACT(year FROM l.data))::integer AS ano,
    (EXTRACT(month FROM l.data))::integer AS mes,
    CASE WHEN (p.natureza = 'C'::bpchar) THEN l.valor ELSE (- l.valor) END AS valor_sinal,
    p.codigo AS plano_codigo, p.nome AS plano_nome, p.tipo,
    c1.id AS classe_id, c1.codigo AS classe_codigo, c1.nome AS classe_nome,
    COALESCE(c1.prioridade, 'Negociável'::text) AS prioridade_classe,
    COALESCE(l.prioridade, c1.prioridade, 'Negociável'::text) AS prioridade_efetiva,
    f.nome AS favorecido_nome, f.sigla AS favorecido_sigla,
    cc.nome AS centro_custo_nome, ct.nome AS conta_nome, ct.grupo_id, ct.disponibilidade, g.nome AS grupo_nome,
    l.documento, l.emissao, l.fidc_proposta_id,
    l.conta_destino_id, cd.nome AS conta_destino_nome
   FROM lancamentos l
     JOIN plano_contas p ON p.id = l.plano_id
     LEFT JOIN plano_contas c1 ON c1.id = p.pai_id
     LEFT JOIN favorecidos f ON f.id = l.favorecido_id
     LEFT JOIN centros_custo cc ON cc.id = l.centro_custo_id
     LEFT JOIN contas ct ON ct.id = l.conta_id
     LEFT JOIN contas cd ON cd.id = l.conta_destino_id
     LEFT JOIN grupos g ON g.id = ct.grupo_id;

-- 7) validação: destino da mesma empresa, só em transferência (plano de saída 3.02)
create or replace function public.tg_lanc_mesma_empresa() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from plano_contas where id = new.plano_id and empresa_id = new.empresa_id and nivel = 2) then
    raise exception 'Plano de contas inválido para esta empresa (use uma conta de nível 2)';
  end if;
  if new.conta_id is not null and not exists (select 1 from contas where id = new.conta_id and empresa_id = new.empresa_id) then
    raise exception 'Conta bancária inválida para esta empresa';
  end if;
  if new.conta_destino_id is not null then
    if not exists (select 1 from contas where id = new.conta_destino_id and empresa_id = new.empresa_id) then
      raise exception 'Conta de destino inválida para esta empresa';
    end if;
    if new.conta_id is null then raise exception 'Transferência precisa da conta de origem'; end if;
    if not exists (select 1 from plano_contas where id = new.plano_id and tipo = 'T' and natureza = 'D') then
      raise exception 'Conta de destino só vale para transferência (plano de transferência de saída, 3.02)';
    end if;
  end if;
  if new.favorecido_id is not null and not exists (select 1 from favorecidos where id = new.favorecido_id and empresa_id = new.empresa_id) then
    raise exception 'Favorecido inválido para esta empresa';
  end if;
  if new.centro_custo_id is not null and not exists (select 1 from centros_custo where id = new.centro_custo_id and empresa_id = new.empresa_id) then
    raise exception 'Centro de custo inválido para esta empresa';
  end if;
  return new;
end $$;

-- 8) trava: vale para a conta de origem e para a de destino
create or replace function public._trava_lancamentos() returns trigger
language plpgsql security definer set search_path = public as $$
declare t_old date; t_new date; nat_old text; nat_new text; nm text; td_old date; td_new date;
begin
  if tg_op in ('UPDATE', 'DELETE') and old.status = 'Pago' then
    if old.conta_id is not null then t_old := trava_ate(old.conta_id); end if;
    if old.conta_destino_id is not null then td_old := trava_ate(old.conta_destino_id); end if;
    if td_old is not null and (t_old is null or td_old > t_old) then t_old := td_old; end if;
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.status = 'Pago' then
    if new.conta_id is not null then t_new := trava_ate(new.conta_id); end if;
    if new.conta_destino_id is not null then td_new := trava_ate(new.conta_destino_id); end if;
    if td_new is not null and (t_new is null or td_new > t_new) then t_new := td_new; end if;
  end if;
  if tg_op = 'DELETE' then
    if t_old is not null and old.data <= t_old then
      raise exception 'Conta travada até %: não é possível excluir o lançamento de %.', to_char(t_old, 'DD/MM/YYYY'), to_char(old.data, 'DD/MM/YYYY');
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' and t_old is not null and old.data <= t_old then
    if new.data is distinct from old.data or new.valor is distinct from old.valor or new.conta_id is distinct from old.conta_id
       or new.status is distinct from old.status or new.conta_destino_id is distinct from old.conta_destino_id then
      select nome into nm from contas where id = old.conta_id;
      raise exception 'A conta % (ou a de destino) está travada até %: data, valor, contas e situação dos lançamentos até essa data não podem mudar (classificação, descrição e centro de custo podem).', nm, to_char(t_old, 'DD/MM/YYYY');
    end if;
    if new.plano_id is distinct from old.plano_id then
      select natureza into nat_old from plano_contas where id = old.plano_id;
      select natureza into nat_new from plano_contas where id = new.plano_id;
      if nat_old is distinct from nat_new then
        select nome into nm from contas where id = old.conta_id;
        raise exception 'A conta % está travada até %: a nova classificação é de natureza diferente (entrada × saída) e mudaria o saldo.', nm, to_char(t_old, 'DD/MM/YYYY');
      end if;
    end if;
    return new;
  end if;
  if t_new is not null and new.data <= t_new then
    raise exception 'Conta travada até %: não é possível lançar ou baixar lançamento com data de % nela.', to_char(t_new, 'DD/MM/YYYY'), to_char(new.data, 'DD/MM/YYYY');
  end if;
  return new;
end $$;

-- 9) conciliação: o mesmo lançamento pode ser conciliado uma vez em cada conta (origem e destino)
alter table public.conciliacoes drop constraint if exists conciliacoes_lancamento_id_key;
create unique index if not exists conciliacoes_lanc_conta on public.conciliacoes(lancamento_id, conta_id);

-- lançamento conciliado: a conta de destino também fica protegida
create or replace function public.tg_lanc_conciliado() returns trigger
language plpgsql set search_path = public as $$
begin
  if pg_trigger_depth() > 1 then return coalesce(new, old); end if;
  if not exists (select 1 from conciliacoes c where c.lancamento_id = old.id) then return coalesce(new, old); end if;
  if tg_op = 'DELETE' then
    raise exception 'Lançamento conciliado com o extrato bancário: desfaça a conciliação antes de excluir';
  end if;
  if (new.data, new.valor, new.plano_id, new.conta_id, new.conta_destino_id, new.status, new.favorecido_id, new.centro_custo_id, new.prioridade, new.documento, new.emissao, new.empresa_id)
     is distinct from
     (old.data, old.valor, old.plano_id, old.conta_id, old.conta_destino_id, old.status, old.favorecido_id, old.centro_custo_id, old.prioridade, old.documento, old.emissao, old.empresa_id) then
    raise exception 'Lançamento conciliado com o extrato bancário: só a descrição e os opcionais podem ser alterados';
  end if;
  return new;
end $$;

-- =====================================================================
-- Aprovação de borderô FIDC: o líquido passa a ser UMA transferência (conta do fundo → conta de crédito)
-- em vez de dois lançamentos (3.02.01 no fundo + 3.01.01 na conta de crédito). Resto da função igual.
-- =====================================================================
create or replace function public._aprovar_proposta_fidc(p_id uuid, p_motivo text, p_aprovador uuid)
returns text language plpgsql security definer set search_path = public as $$
declare pr fidc_propostas; fu fidc_fundos; n_aberto int; n_itens int; n_sem int; v_origem text; v_op uuid; v_rot text;
        pl_jur uuid; pl_tar uuid; pl_rec uuid; pl_td uuid; pl_tc uuid; v_cc uuid;
begin
  select * into pr from fidc_propostas where id = p_id for update;
  if not found then raise exception 'Proposta não encontrada'; end if;
  if pr.status <> 'Pendente' then raise exception 'A proposta nº % não está pendente (status: %)', pr.numero, pr.status; end if;
  select * into fu from fidc_fundos where id = pr.fundo_id;
  if fu.conta_id is null then raise exception 'Cadastre a conta do fundo % antes de aprovar', fu.nome; end if;

  if pr.origem = 'base_fidc' then
    update fidc_proposta_itens i set lancamento_id = x.lid
      from (select distinct on (i2.id) i2.id iid, l.id lid
              from fidc_proposta_itens i2
              join lancamentos l on l.empresa_id = pr.empresa_id and l.fidc_proposta_id is null
                and (l.status = 'Em aberto' or (l.status = 'Pago' and l.conta_id is null))
                and nf_parcela(coalesce(l.documento, l.descricao)) = nf_parcela(i2.documento) and abs(l.valor - i2.valor) <= 0.05
             where i2.proposta_id = p_id and i2.lancamento_id is null
               and not exists (select 1 from fidc_proposta_itens o where o.lancamento_id = l.id)
             order by i2.id, (l.status = 'Em aberto') desc, l.data) x
     where i.id = x.iid;
    select count(*) into n_sem from fidc_proposta_itens where proposta_id = p_id and lancamento_id is null;
    if n_sem > 0 then raise exception '% título(s) deste borderô ainda não estão lançados em aberto. Gere as contas a receber das notas (Notas Fiscais › Recebimentos × Notas) e aprove de novo.', n_sem; end if;
  end if;

  select count(*), count(*) filter (where (l.status = 'Em aberto' or (pr.origem = 'base_fidc' and l.status = 'Pago' and l.conta_id is null)) and l.fidc_proposta_id is null)
    into n_itens, n_aberto
    from fidc_proposta_itens i join lancamentos l on l.id = i.lancamento_id where i.proposta_id = p_id;
  if n_itens = 0 then raise exception 'Proposta sem títulos vinculados'; end if;
  if n_aberto <> n_itens then raise exception '% título(s) já não estão em aberto ou estão em outra proposta', n_itens - n_aberto; end if;

  select id into pl_jur from plano_contas where empresa_id = pr.empresa_id and codigo = '2.07.08';
  select id into pl_tar from plano_contas where empresa_id = pr.empresa_id and codigo = '2.07.32';
  select id into pl_rec from plano_contas where empresa_id = pr.empresa_id and codigo = '2.07.11';
  select id into pl_td  from plano_contas where empresa_id = pr.empresa_id and codigo = '3.02.01';
  select id into pl_tc  from plano_contas where empresa_id = pr.empresa_id and codigo = '3.01.01';
  select id into v_cc from centros_custo where empresa_id = pr.empresa_id and nome = 'FINANCEIRO';
  v_origem := 'fidc:proposta:' || pr.numero;
  v_rot := case when pr.origem = 'base_fidc' then format('borderô %s', coalesce(pr.comparativo->>'bordero', '')) else 'estimado' end;

  perform set_config('app.aprovando', 'sim', true);
  update lancamentos l set status = 'Pago', data = pr.data_operacao, conta_id = fu.conta_id, fidc_proposta_id = p_id
    from fidc_proposta_itens i where i.proposta_id = p_id and i.lancamento_id = l.id;

  if pl_jur is not null and pr.desagio > 0 then
    insert into lancamentos(empresa_id, data, plano_id, descricao, centro_custo_id, status, conta_id, valor, origem, fidc_proposta_id)
    values (pr.empresa_id, pr.data_operacao, pl_jur, format('%s — deságio proposta nº %s (%s)', fu.nome, pr.numero, v_rot), v_cc, 'Pago', fu.conta_id, pr.desagio, v_origem, p_id);
  end if;
  if pl_tar is not null and pr.ad_valorem + pr.tarifas + pr.iof > 0 then
    insert into lancamentos(empresa_id, data, plano_id, descricao, centro_custo_id, status, conta_id, valor, origem, fidc_proposta_id)
    values (pr.empresa_id, pr.data_operacao, pl_tar, format('%s — tarifas/IOF proposta nº %s (%s)', fu.nome, pr.numero, v_rot), v_cc, 'Pago', fu.conta_id, pr.ad_valorem + pr.tarifas + pr.iof, v_origem, p_id);
  end if;
  if pl_rec is not null and pr.recompras > 0 then
    insert into lancamentos(empresa_id, data, plano_id, descricao, centro_custo_id, status, conta_id, valor, origem, fidc_proposta_id)
    values (pr.empresa_id, pr.data_operacao, pl_rec, format('%s — recompras descontadas proposta nº %s', fu.nome, pr.numero), v_cc, 'Pago', fu.conta_id, pr.recompras, v_origem, p_id);
  end if;
  if pl_td is not null and pr.liquido > 0 and coalesce(pr.conta_credito_id, fu.conta_credito_id) is not null then
    -- transferência única: sai da conta do fundo e entra na conta de crédito, num lançamento só
    insert into lancamentos(empresa_id, data, plano_id, descricao, centro_custo_id, status, conta_id, conta_destino_id, valor, origem, fidc_proposta_id)
    values (pr.empresa_id, pr.data_operacao, pl_td, format('%s — líquido proposta nº %s', fu.nome, pr.numero), v_cc, 'Pago', fu.conta_id, coalesce(pr.conta_credito_id, fu.conta_credito_id), pr.liquido, v_origem, p_id);
  end if;

  if pr.origem = 'base_fidc' and pr.operacao_id is not null then
    v_op := pr.operacao_id;
  else
    insert into fidc_operacoes(empresa_id, fundo, data, bordero, arquivo, conta_id, qtd_titulos, valor_face, desagio, ad_valorem, tarifas, iof,
                               encargos, recompra, desc_sacado, liquido, prazo_medio, prazo_cobrado, observacao)
    values (pr.empresa_id, fu.nome, pr.data_operacao, 'P' || pr.numero, 'Proposta nº ' || pr.numero || ' (plataforma)', fu.conta_id, pr.qtd_titulos,
            pr.valor_face, pr.desagio, pr.ad_valorem, pr.tarifas, pr.iof, 0, pr.recompras, 0, pr.liquido, pr.prazo_medio, pr.prazo_cobrado,
            nullif(concat_ws('; ', pr.observacao, p_motivo), ''))
    returning id into v_op;
    insert into fidc_titulos(empresa_id, operacao_id, fundo, bordero, data_operacao, titulo, vencimento, valor, cnpj_sacado, sacado, sacado_agrupado)
    select pr.empresa_id, v_op, fu.nome, 'P' || pr.numero, pr.data_operacao, i.documento, i.vencimento, i.valor, i.cnpj, i.sacado, i.sacado
      from fidc_proposta_itens i where i.proposta_id = p_id;
  end if;

  update fidc_propostas set status = 'Aprovada', motivo = p_motivo, aprovado_por = p_aprovador, aprovado_em = now(), operacao_id = v_op where id = p_id;
  return 'Aprovada';
end $$;

-- =====================================================================
-- Etapa 7: transferência nova só no formato único (origem → destino)
--  - não aceita mais lançar transferência de entrada (3.01) nem transferência de saída sem conta de destino
--  - as 22 pontas antigas que ficaram sem par continuam podendo ser corrigidas/excluídas (a regra vale só para inclusão)
-- =====================================================================
create or replace function public._transf_so_unica() returns trigger
language plpgsql set search_path = public as $$
declare p plano_contas;
begin
  select * into p from plano_contas where id = new.plano_id;
  if p.tipo = 'T' then
    if p.natureza = 'C' then
      raise exception 'Transferência agora é um lançamento só: use o plano de transferência de saída (3.02) com a conta de origem e a de destino.';
    end if;
    if new.conta_destino_id is null then
      raise exception 'Informe a conta de destino da transferência (De → Para).';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists transf_so_unica on public.lancamentos;
create trigger transf_so_unica before insert on public.lancamentos for each row execute function public._transf_so_unica();

-- =====================================================================
-- Paraquedas: quem autoriza passa a ser o DIRETOR ou o FINANCEIRO (além do administrador)
-- =====================================================================
create or replace function public.pode_aprovar_paraquedas(p_empresa uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from membros where empresa_id = p_empresa and user_id = auth.uid() and papel::text in ('admin', 'diretor', 'financeiro'));
$$;

create or replace function public._paraquedas_regras() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    select coalesce(max(numero), 0) + 1 into new.numero from paraquedas where empresa_id = new.empresa_id;
    new.status := 'aguardando'; new.aprovado_por := null; new.aprovado_em := null;
    new.criado_por := auth.uid(); new.cnpj := nullif(regexp_replace(coalesce(new.cnpj, ''), '\D', '', 'g'), '');
    return new;
  end if;
  new.atualizado_em := now(); new.numero := old.numero; new.criado_por := old.criado_por;
  new.cnpj := nullif(regexp_replace(coalesce(new.cnpj, ''), '\D', '', 'g'), '');
  if new.status is distinct from old.status then
    if new.status in ('aprovado', 'rejeitado') and old.status = 'aguardando' then
      if not pode_aprovar_paraquedas(new.empresa_id) then raise exception 'Só o diretor ou o financeiro autoriza paraquedas.'; end if;
      new.aprovado_por := auth.uid(); new.aprovado_em := now();
    elsif new.status = 'aguardando' and old.status = 'rejeitado' then
      new.aprovado_por := null; new.aprovado_em := null;     -- reenviado depois de corrigido
    elsif new.status = 'cancelado' then
      if old.status in ('pago', 'nota_recebida') then raise exception 'Paraquedas já pago não pode ser cancelado.'; end if;
    elsif new.status in ('pago', 'nota_recebida') and old.status in ('aprovado', 'pago') then
      null;
    else
      raise exception 'Mudança de situação não permitida: % → %', old.status, new.status;
    end if;
  end if;
  -- depois de aprovado, valor e recebedor só mudam voltando para aprovação
  if old.status <> 'aguardando' and old.status <> 'rejeitado' and new.status not in ('aguardando')
     and (new.valor is distinct from old.valor or new.razao_social is distinct from old.razao_social or new.cnpj is distinct from old.cnpj
          or new.pix_chave is distinct from old.pix_chave or new.conta_bancaria is distinct from old.conta_bancaria) then
    raise exception 'Paraquedas já aprovado: valor e dados de quem recebe não podem mudar. Cancele e lance outro.';
  end if;
  return new;
end $$;

-- =====================================================================
-- Acesso por área: Financeiro (fin), CPD (cpd) e Contabilidade (cont)
--  - membros.areas = lista de áreas que o usuário enxerga no menu
--  - vazio (null) = todas as áreas → é o valor de todos os usuários atuais,
--    então NADA muda para quem já usa a plataforma até o administrador marcar
--  - não apaga nem altera nenhum dado: só acrescenta uma coluna
--  - o que cada um pode EDITAR continua sendo decidido pelo papel
--    (leitura, financeiro, diretor…), que o banco já garante
-- =====================================================================
alter table public.membros add column if not exists areas text[];

alter table public.membros drop constraint if exists membros_areas_validas;
alter table public.membros add constraint membros_areas_validas
  check (areas is null or (cardinality(areas) > 0 and areas <@ array['fin', 'cpd', 'cont']::text[]));

comment on column public.membros.areas is 'Áreas visíveis no menu (fin, cpd, cont). Nulo = todas.';

-- a lista de usuários da tela "Empresa e usuários" passa a trazer as áreas
-- (mudar as colunas de retorno exige recriar a função; a regra de quem pode ver continua a mesma)
drop function if exists public.listar_membros(uuid);
create function public.listar_membros(p_empresa uuid)
returns table(user_id uuid, email text, papel public.papel_membro, created_at timestamptz, areas text[])
language sql stable security definer set search_path = public, auth as $$
  select m.user_id, u.email::text, m.papel, m.created_at, m.areas
  from membros m join auth.users u on u.id = m.user_id
  where m.empresa_id = p_empresa and is_membro(p_empresa)
  order by m.created_at;
$$;

-- =====================================================================
-- Contabilidade — etapa 1: plano de contas contábil, balancetes da contabilidade e saldo de abertura
--  - só cria tabelas novas; não toca em lançamentos, contas bancárias, conciliações nem plano gerencial
--  - valores com sinal: devedor positivo, credor negativo (débito/crédito do período sempre positivos)
--  - gravação só pela função importar_balancete_contabil, que confere tudo de novo no banco
-- =====================================================================

-- 1) plano de contas contábil (vem do balancete da contabilidade; nunca é apagado pela importação)
create table if not exists public.contab_contas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  codigo int,                                   -- código reduzido da contabilidade
  classificacao text not null,                  -- ex.: 1.1.10.200.0003
  descricao text not null,
  nivel int not null,
  tipo char(1) not null check (tipo in ('S', 'A')),        -- sintética / analítica
  natureza char(1) not null check (natureza in ('D', 'C')),
  pai_id uuid references public.contab_contas(id) on delete set null,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (empresa_id, classificacao)
);
create index if not exists contab_contas_cod on public.contab_contas(empresa_id, codigo);

-- 2) balancetes oficiais importados (um por período; reimportar o mesmo período substitui)
create table if not exists public.contab_balancetes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  data_ini date not null,
  data_fim date not null,
  arquivo_nome text,
  arquivo_hash text,                            -- SHA-256 do PDF importado
  resumo jsonb,                                 -- "Resumo do balancete" da última página
  importado_por uuid default auth.uid(),
  importado_email text default (auth.jwt() ->> 'email'),
  importado_em timestamptz not null default now(),
  unique (empresa_id, data_ini, data_fim),
  check (data_fim >= data_ini)
);

create table if not exists public.contab_balancete_itens (
  balancete_id uuid not null references public.contab_balancetes(id) on delete cascade,
  conta_id uuid not null references public.contab_contas(id) on delete cascade,
  saldo_anterior numeric(16,2) not null default 0,
  debito numeric(16,2) not null default 0,
  credito numeric(16,2) not null default 0,
  saldo_atual numeric(16,2) not null default 0,
  primary key (balancete_id, conta_id)
);
create index if not exists contab_bal_itens_conta on public.contab_balancete_itens(conta_id);

-- 3) saldo de abertura (ponto de partida da contabilidade feita pela plataforma)
create table if not exists public.contab_saldos_abertura (
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  data date not null,                           -- saldo no fim deste dia (ex.: 31/12/2025)
  conta_id uuid not null references public.contab_contas(id) on delete cascade,
  saldo numeric(16,2) not null,
  balancete_id uuid references public.contab_balancetes(id) on delete set null,
  primary key (conta_id, data)
);
create index if not exists contab_abertura_emp on public.contab_saldos_abertura(empresa_id, data);

-- RLS: todos os membros consultam; gravação só pela função abaixo (e excluir balancete: quem edita)
alter table public.contab_contas enable row level security;
alter table public.contab_balancetes enable row level security;
alter table public.contab_balancete_itens enable row level security;
alter table public.contab_saldos_abertura enable row level security;
drop policy if exists contab_contas_sel on public.contab_contas;
drop policy if exists contab_bal_sel on public.contab_balancetes;
drop policy if exists contab_bal_del on public.contab_balancetes;
drop policy if exists contab_bal_itens_sel on public.contab_balancete_itens;
drop policy if exists contab_abertura_sel on public.contab_saldos_abertura;
create policy contab_contas_sel on public.contab_contas for select to authenticated using (public.is_membro(empresa_id));
create policy contab_bal_sel on public.contab_balancetes for select to authenticated using (public.is_membro(empresa_id));
create policy contab_bal_del on public.contab_balancetes for delete to authenticated using (public.pode_editar(empresa_id));
create policy contab_bal_itens_sel on public.contab_balancete_itens for select to authenticated
  using (exists (select 1 from public.contab_balancetes b where b.id = balancete_id and public.is_membro(b.empresa_id)));
create policy contab_abertura_sel on public.contab_saldos_abertura for select to authenticated using (public.is_membro(empresa_id));
grant select on public.contab_contas, public.contab_balancetes, public.contab_balancete_itens, public.contab_saldos_abertura to authenticated;
grant delete on public.contab_balancetes to authenticated;

-- 4) importação (tudo ou nada)
-- p_contas: [{codigo, classificacao, descricao, nivel, tipo, natureza, pai, ant, deb, cred, atu}, ...] na ordem do relatório
create or replace function public.importar_balancete_contabil(
  p_empresa uuid, p_ini date, p_fim date, p_arquivo text, p_hash text, p_resumo jsonb, p_contas jsonb, p_abertura boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_bal uuid; v_n int; v_dif numeric; v_novas int; v_abert date := p_ini - 1;
begin
  if not public.pode_editar(p_empresa) then raise exception 'Sem permissão para importar balancete.'; end if;
  if jsonb_typeof(p_contas) <> 'array' or jsonb_array_length(p_contas) = 0 then raise exception 'Balancete sem contas.'; end if;

  drop table if exists _bal;
  create temp table _bal on commit drop as
    select (e->>'codigo')::int codigo, e->>'classificacao' classificacao, left(e->>'descricao', 200) descricao,
           (e->>'nivel')::int nivel, e->>'tipo' tipo, e->>'natureza' natureza, e->>'pai' pai,
           round((e->>'ant')::numeric, 2) ant, round((e->>'deb')::numeric, 2) deb, round((e->>'cred')::numeric, 2) cred, round((e->>'atu')::numeric, 2) atu
    from jsonb_array_elements(p_contas) e;

  -- conferências no banco (as mesmas da tela)
  if exists (select 1 from _bal where classificacao !~ '^\d+(\.\d+)*$' or descricao is null or tipo not in ('S','A') or natureza not in ('D','C')) then
    raise exception 'Balancete com conta inválida.'; end if;
  if (select count(*) from _bal) <> (select count(distinct classificacao) from _bal) then raise exception 'Balancete com conta repetida.'; end if;
  select count(*) into v_n from _bal where abs(ant + deb - cred - atu) > 0.01;
  if v_n > 0 then raise exception 'Balancete não confere: % conta(s) com anterior + débito − crédito diferente do saldo atual.', v_n; end if;
  select coalesce(sum(atu), 0) into v_dif from _bal where nivel = 1;
  if abs(v_dif) > 0.01 then raise exception 'Balancete não fecha: devedoras − credoras = %.', v_dif; end if;
  select coalesce(sum(ant), 0) into v_dif from _bal where nivel = 1;
  if abs(v_dif) > 0.01 then raise exception 'Saldo anterior não fecha: devedoras − credoras = %.', v_dif; end if;
  select count(*) into v_n from _bal m where m.tipo = 'S' and abs(m.atu - (select coalesce(sum(f.atu), 0) from _bal f where f.pai = m.classificacao)) > 0.01;
  if v_n > 0 then raise exception 'Balancete não confere: % conta(s) sintética(s) diferente(s) da soma das contas abaixo.', v_n; end if;

  -- plano de contas: inclui as novas e atualiza descrição/código/estrutura das existentes
  select count(*) into v_novas from _bal b where not exists (select 1 from contab_contas c where c.empresa_id = p_empresa and c.classificacao = b.classificacao);
  insert into contab_contas(empresa_id, codigo, classificacao, descricao, nivel, tipo, natureza)
    select p_empresa, codigo, classificacao, descricao, nivel, tipo, natureza from _bal
  on conflict (empresa_id, classificacao) do update
    set codigo = excluded.codigo, descricao = excluded.descricao, nivel = excluded.nivel, tipo = excluded.tipo,
        natureza = excluded.natureza, ativo = true, updated_at = now();
  update contab_contas c set pai_id = p.id
    from _bal b join contab_contas p on p.empresa_id = p_empresa and p.classificacao = b.pai
   where c.empresa_id = p_empresa and c.classificacao = b.classificacao and c.pai_id is distinct from p.id;

  -- balancete do período (substitui se já existia)
  delete from contab_balancetes where empresa_id = p_empresa and data_ini = p_ini and data_fim = p_fim;
  insert into contab_balancetes(empresa_id, data_ini, data_fim, arquivo_nome, arquivo_hash, resumo)
    values (p_empresa, p_ini, p_fim, p_arquivo, p_hash, p_resumo) returning id into v_bal;
  insert into contab_balancete_itens(balancete_id, conta_id, saldo_anterior, debito, credito, saldo_atual)
    select v_bal, c.id, b.ant, b.deb, b.cred, b.atu from _bal b join contab_contas c on c.empresa_id = p_empresa and c.classificacao = b.classificacao;

  -- saldo de abertura = saldo anterior das contas analíticas, no dia anterior ao início do período
  if p_abertura then
    delete from contab_saldos_abertura where empresa_id = p_empresa and data = v_abert;
    insert into contab_saldos_abertura(empresa_id, data, conta_id, saldo, balancete_id)
      select p_empresa, v_abert, c.id, b.ant, v_bal from _bal b join contab_contas c on c.empresa_id = p_empresa and c.classificacao = b.classificacao
       where b.tipo = 'A' and b.ant <> 0;
  end if;

  return jsonb_build_object('balancete_id', v_bal, 'contas', (select count(*) from _bal), 'novas', v_novas,
    'abertura', case when p_abertura then v_abert end);
end $$;
revoke all on function public.importar_balancete_contabil(uuid, date, date, text, text, jsonb, jsonb, boolean) from public, anon;
grant execute on function public.importar_balancete_contabil(uuid, date, date, text, text, jsonb, jsonb, boolean) to authenticated;

-- =====================================================================
-- Contabilidade — etapas 2 e 3: de-para e motor de partidas dobradas (fatos financeiros)
--  - rodar DEPOIS da 20261014000034_contabilidade_base.sql
--  - só cria tabelas/funções novas; NÃO altera lançamentos, contas, favorecidos nem conciliações
--  - os lançamentos contábeis gerados podem ser apagados e gerados de novo a qualquer momento
-- =====================================================================

-- 1) de-para: classificação gerencial → conta contábil da contrapartida
create table if not exists public.contab_depara_plano (
  plano_id uuid primary key references public.plano_contas(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  conta_id uuid references public.contab_contas(id) on delete restrict,      -- conta usada quando não há conta do favorecido
  tratamento text not null check (tratamento in ('resultado','fornecedor','cliente','obrigacao','ativo','financiamento','transferencia')),
  papel text check (papel in ('cliente','fornecedor','adiant_fornecedor','adiant_cliente','outras_obrig')), -- usa a conta do favorecido neste papel
  observacao text,
  atualizado_por text default (auth.jwt() ->> 'email'),
  atualizado_em timestamptz not null default now()
);
create index if not exists contab_depara_plano_emp on public.contab_depara_plano(empresa_id);

-- conta bancária da plataforma → conta contábil (e a conta para saldo negativo, ex.: cheque especial)
create table if not exists public.contab_depara_conta (
  conta_bancaria_id uuid primary key references public.contas(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  conta_id uuid not null references public.contab_contas(id) on delete restrict,
  conta_negativa_id uuid references public.contab_contas(id) on delete restrict,
  observacao text,
  atualizado_por text default (auth.jwt() ->> 'email'),
  atualizado_em timestamptz not null default now()
);

-- beneficiário → conta própria na contabilidade (cliente, fornecedor, adiantamentos…)
create table if not exists public.contab_depara_favorecido (
  favorecido_id uuid not null references public.favorecidos(id) on delete cascade,
  papel text not null check (papel in ('cliente','fornecedor','adiant_fornecedor','adiant_cliente','outras_obrig')),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  conta_id uuid not null references public.contab_contas(id) on delete restrict,
  atualizado_por text default (auth.jwt() ->> 'email'),
  atualizado_em timestamptz not null default now(),
  primary key (favorecido_id, papel)
);
create index if not exists contab_depara_fav_emp on public.contab_depara_favorecido(empresa_id);

-- 2) lançamentos contábeis (partidas dobradas)
create table if not exists public.contab_lancamentos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  data date not null,
  historico text,
  origem text not null check (origem in ('financeiro','nota','fidc','folha','apuracao','depreciacao','estoque','manual')),
  origem_id uuid,                               -- ex.: id do lançamento financeiro que gerou
  gerado_por text default (auth.jwt() ->> 'email'),
  gerado_em timestamptz not null default now()
);
create index if not exists contab_lanc_emp_data on public.contab_lancamentos(empresa_id, data);
create index if not exists contab_lanc_origem on public.contab_lancamentos(origem, origem_id);

create table if not exists public.contab_partidas (
  id bigserial primary key,
  lancamento_id uuid not null references public.contab_lancamentos(id) on delete cascade,
  conta_id uuid not null references public.contab_contas(id) on delete restrict,
  debito numeric(16,2) not null default 0,
  credito numeric(16,2) not null default 0,
  check (debito >= 0 and credito >= 0 and (debito = 0 or credito = 0) and debito + credito > 0)
);
create index if not exists contab_partidas_lanc on public.contab_partidas(lancamento_id);
create index if not exists contab_partidas_conta on public.contab_partidas(conta_id);

-- todo lançamento contábil fecha (débitos = créditos), conferido no fim da transação
create or replace function public._contab_partidas_fecham() returns trigger
language plpgsql set search_path = public as $$
declare v_id uuid := coalesce(new.lancamento_id, old.lancamento_id); v numeric;
begin
  if not exists (select 1 from contab_lancamentos where id = v_id) then return null; end if;
  select coalesce(sum(debito - credito), 0) into v from contab_partidas where lancamento_id = v_id;
  if abs(v) > 0.005 then raise exception 'Lançamento contábil % não fecha: débitos − créditos = %', v_id, v; end if;
  return null;
end $$;
drop trigger if exists contab_partidas_fecham on public.contab_partidas;
create constraint trigger contab_partidas_fecham after insert or update or delete on public.contab_partidas
  deferrable initially deferred for each row execute function public._contab_partidas_fecham();

-- RLS
alter table public.contab_depara_plano enable row level security;
alter table public.contab_depara_conta enable row level security;
alter table public.contab_depara_favorecido enable row level security;
alter table public.contab_lancamentos enable row level security;
alter table public.contab_partidas enable row level security;
do $$ declare t text; begin
  foreach t in array array['contab_depara_plano','contab_depara_conta','contab_depara_favorecido'] loop
    execute format('drop policy if exists %1$s_sel on public.%1$s; drop policy if exists %1$s_ins on public.%1$s; drop policy if exists %1$s_upd on public.%1$s; drop policy if exists %1$s_del on public.%1$s;', t);
    execute format('create policy %1$s_sel on public.%1$s for select to authenticated using (public.is_membro(empresa_id));', t);
    execute format('create policy %1$s_ins on public.%1$s for insert to authenticated with check (public.pode_editar(empresa_id));', t);
    execute format('create policy %1$s_upd on public.%1$s for update to authenticated using (public.pode_editar(empresa_id)) with check (public.pode_editar(empresa_id));', t);
    execute format('create policy %1$s_del on public.%1$s for delete to authenticated using (public.pode_editar(empresa_id));', t);
    execute format('grant select, insert, update, delete on public.%1$s to authenticated;', t);
  end loop;
end $$;
drop policy if exists contab_lanc_sel on public.contab_lancamentos;
drop policy if exists contab_part_sel on public.contab_partidas;
create policy contab_lanc_sel on public.contab_lancamentos for select to authenticated using (public.is_membro(empresa_id));
create policy contab_part_sel on public.contab_partidas for select to authenticated
  using (exists (select 1 from public.contab_lancamentos l where l.id = lancamento_id and public.is_membro(l.empresa_id)));
grant select on public.contab_lancamentos, public.contab_partidas to authenticated;

-- a conta do de-para tem de ser da mesma empresa
create or replace function public._contab_depara_mesma_empresa() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.conta_id is not null and not exists (select 1 from contab_contas where id = new.conta_id and empresa_id = new.empresa_id) then
    raise exception 'Conta contábil de outra empresa.'; end if;
  if tg_table_name = 'contab_depara_conta' then
    if (to_jsonb(new) ->> 'conta_negativa_id') is not null
       and not exists (select 1 from contab_contas where id = (to_jsonb(new) ->> 'conta_negativa_id')::uuid and empresa_id = new.empresa_id) then
      raise exception 'Conta contábil de outra empresa.'; end if;
  end if;
  new.atualizado_por := auth.jwt() ->> 'email'; new.atualizado_em := now();
  return new;
end $$;
drop trigger if exists contab_depara_plano_emp on public.contab_depara_plano;
drop trigger if exists contab_depara_conta_emp on public.contab_depara_conta;
drop trigger if exists contab_depara_fav_emp on public.contab_depara_favorecido;
create trigger contab_depara_plano_emp before insert or update on public.contab_depara_plano for each row execute function public._contab_depara_mesma_empresa();
create trigger contab_depara_conta_emp before insert or update on public.contab_depara_conta for each row execute function public._contab_depara_mesma_empresa();
create trigger contab_depara_fav_emp before insert or update on public.contab_depara_favorecido for each row execute function public._contab_depara_mesma_empresa();

-- 3) motor: lançamentos financeiros PAGOS do período → partidas dobradas
--    entrada (classificação C): D banco / C contrapartida ; saída (D): D contrapartida / C banco
--    transferência única: D banco de destino / C banco de origem
--    o que não tiver de-para não é gerado e volta como pendência (com o motivo)
create or replace function public.gerar_contabil_financeiro(p_empresa uuid, p_ini date, p_fim date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_apag int; v_lanc int; v_pend jsonb;
begin
  if not public.pode_editar(p_empresa) then raise exception 'Sem permissão.'; end if;
  if p_fim < p_ini or p_fim - p_ini > 400 then raise exception 'Período inválido.'; end if;

  drop table if exists _cf;
  create temp table _cf on commit drop as
  select l.id, l.data, l.valor, l.descricao, p.codigo || ' ' || p.nome as classif, p.natureza, p.tipo as ptipo,
         dc.conta_id as banco, dd.conta_id as banco_dest, l.conta_destino_id,
         case when l.conta_destino_id is not null then null
              else coalesce(df.conta_id, dp.conta_id) end as contra,
         dp.plano_id is not null as tem_depara, dp.tratamento,
         case
           when dc.conta_id is null then 'Conta bancária sem conta contábil'
           when l.conta_destino_id is not null and dd.conta_id is null then 'Conta de destino sem conta contábil'
           when l.conta_destino_id is null and p.tipo = 'T' then 'Transferência sem conta de destino (ponta antiga)'
           when l.conta_destino_id is null and dp.plano_id is null then 'Classificação sem de-para'
           when l.conta_destino_id is null and coalesce(df.conta_id, dp.conta_id) is null then 'Beneficiário sem conta contábil'
         end as motivo
    from lancamentos l
    join plano_contas p on p.id = l.plano_id
    left join contab_depara_conta dc on dc.conta_bancaria_id = l.conta_id
    left join contab_depara_conta dd on dd.conta_bancaria_id = l.conta_destino_id
    left join contab_depara_plano dp on dp.plano_id = l.plano_id
    left join contab_depara_favorecido df on df.favorecido_id = l.favorecido_id and df.papel = dp.papel
   where l.empresa_id = p_empresa and l.status = 'Pago' and l.data between p_ini and p_fim and l.valor <> 0;

  delete from contab_lancamentos where empresa_id = p_empresa and origem = 'financeiro' and data between p_ini and p_fim;
  get diagnostics v_apag = row_count;

  insert into contab_lancamentos(empresa_id, data, historico, origem, origem_id)
    select p_empresa, data, left(coalesce(descricao, '') || ' [' || classif || ']', 300), 'financeiro', id from _cf where motivo is null;
  get diagnostics v_lanc = row_count;

  insert into contab_partidas(lancamento_id, conta_id, debito, credito)
  select cl.id, x.conta, x.d, x.c
    from _cf f join contab_lancamentos cl on cl.origem = 'financeiro' and cl.origem_id = f.id and cl.empresa_id = p_empresa,
    lateral (values
      -- débito
      (case when f.conta_destino_id is not null then f.banco_dest when f.natureza = 'C' then f.banco else f.contra end, abs(f.valor), 0::numeric),
      -- crédito
      (case when f.conta_destino_id is not null then f.banco when f.natureza = 'C' then f.contra else f.banco end, 0::numeric, abs(f.valor))
    ) as x(conta, d, c)
   where f.motivo is null;

  select coalesce(jsonb_agg(jsonb_build_object('motivo', motivo, 'qtd', qtd, 'valor', valor, 'exemplos', ex) order by qtd desc), '[]'::jsonb) into v_pend
    from (select motivo, count(*) qtd, round(sum(abs(valor)), 2) valor,
                 (select jsonb_agg(jsonb_build_object('id', id, 'data', data, 'valor', valor, 'classif', classif, 'descricao', descricao))
                    from (select * from _cf g where g.motivo = f.motivo order by abs(valor) desc limit 30) s) ex
            from _cf f where motivo is not null group by motivo) t;

  return jsonb_build_object('apagados', v_apag, 'gerados', v_lanc, 'pendentes', (select count(*) from _cf where motivo is not null), 'pendencias', v_pend);
end $$;
revoke all on function public.gerar_contabil_financeiro(uuid, date, date) from public, anon;
grant execute on function public.gerar_contabil_financeiro(uuid, date, date) to authenticated;

-- 4) balancete gerencial (feito pela plataforma) das contas analíticas, a partir do saldo de abertura
--    saldo com sinal: devedor +, credor −
create or replace function public.contab_balancete_gerencial(p_empresa uuid, p_ini date, p_fim date)
returns table(conta_id uuid, saldo_anterior numeric, debito numeric, credito numeric, saldo_atual numeric)
language sql stable security definer set search_path = public as $$
  with ab as (
    select max(data) d from contab_saldos_abertura where empresa_id = p_empresa and data < p_ini
  ), mov as (
    select pt.conta_id,
           sum(case when l.data < p_ini then pt.debito - pt.credito else 0 end) antes,
           sum(case when l.data >= p_ini then pt.debito else 0 end) deb,
           sum(case when l.data >= p_ini then pt.credito else 0 end) cred
      from contab_partidas pt join contab_lancamentos l on l.id = pt.lancamento_id, ab
     where l.empresa_id = p_empresa and l.data > ab.d and l.data <= p_fim
     group by pt.conta_id
  ), abert as (
    select s.conta_id, s.saldo from contab_saldos_abertura s, ab where s.empresa_id = p_empresa and s.data = ab.d
  )
  select c.id, round(coalesce(a.saldo, 0) + coalesce(m.antes, 0), 2), round(coalesce(m.deb, 0), 2), round(coalesce(m.cred, 0), 2),
         round(coalesce(a.saldo, 0) + coalesce(m.antes, 0) + coalesce(m.deb, 0) - coalesce(m.cred, 0), 2)
    from contab_contas c left join abert a on a.conta_id = c.id left join mov m on m.conta_id = c.id
   where c.empresa_id = p_empresa and public.is_membro(p_empresa) and (a.conta_id is not null or m.conta_id is not null)
     and (select d from ab) is not null;
$$;
revoke all on function public.contab_balancete_gerencial(uuid, date, date) from public, anon;
grant execute on function public.contab_balancete_gerencial(uuid, date, date) to authenticated;

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

-- ===== 20261015000037_pagamento_antecipado_textos.sql =====
-- =====================================================================
-- "Paraquedas" passa a se chamar "Pagamento Antecipado" (PA nº) nas mensagens do banco
--  - só troca textos de avisos e de erros; regras, tabelas e dados continuam iguais
-- =====================================================================
create or replace function public._paraquedas_regras() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    select coalesce(max(numero), 0) + 1 into new.numero from paraquedas where empresa_id = new.empresa_id;
    new.status := 'aguardando'; new.aprovado_por := null; new.aprovado_em := null;
    new.criado_por := auth.uid(); new.cnpj := nullif(regexp_replace(coalesce(new.cnpj, ''), '\D', '', 'g'), '');
    return new;
  end if;
  new.atualizado_em := now(); new.numero := old.numero; new.criado_por := old.criado_por;
  new.cnpj := nullif(regexp_replace(coalesce(new.cnpj, ''), '\D', '', 'g'), '');
  if new.status is distinct from old.status then
    if new.status in ('aprovado', 'rejeitado') and old.status = 'aguardando' then
      if not pode_aprovar_paraquedas(new.empresa_id) then raise exception 'Só o diretor ou o financeiro autoriza pagamento antecipado.'; end if;
      new.aprovado_por := auth.uid(); new.aprovado_em := now();
    elsif new.status = 'aguardando' and old.status = 'rejeitado' then
      new.aprovado_por := null; new.aprovado_em := null;     -- reenviado depois de corrigido
    elsif new.status = 'cancelado' then
      if old.status in ('pago', 'nota_recebida') then raise exception 'Pagamento antecipado já pago não pode ser cancelado.'; end if;
    elsif new.status in ('pago', 'nota_recebida') and old.status in ('aprovado', 'pago') then
      null;
    else
      raise exception 'Mudança de situação não permitida: % → %', old.status, new.status;
    end if;
  end if;
  -- depois de aprovado, valor e recebedor só mudam voltando para aprovação
  if old.status <> 'aguardando' and old.status <> 'rejeitado' and new.status not in ('aguardando')
     and (new.valor is distinct from old.valor or new.razao_social is distinct from old.razao_social or new.cnpj is distinct from old.cnpj
          or new.pix_chave is distinct from old.pix_chave or new.conta_bancaria is distinct from old.conta_bancaria) then
    raise exception 'Pagamento antecipado já autorizado: valor e dados de quem recebe não podem mudar. Cancele e lance outro.';
  end if;
  return new;
end $$;

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
      case when new.prioridade = 'urgente' then 'URGENTE · ' else '' end || 'Pagamento antecipado PA nº ' || new.numero
        || case when tg_op = 'INSERT' then ' aguardando autorização' else ' reenviado para autorização' end,
      resumo, '#/paraquedas', new.id);
    return new;
  end if;
  if new.status is distinct from old.status then
    if new.status = 'aprovado' then
      perform _notificar(new.empresa_id, array[new.criado_por], 'paraquedas_aprovado', 'Pagamento antecipado PA nº ' || new.numero || ' autorizado', resumo, '#/paraquedas', new.id);
    elsif new.status = 'rejeitado' then
      perform _notificar(new.empresa_id, array[new.criado_por], 'paraquedas_rejeitado', 'Pagamento antecipado PA nº ' || new.numero || ' recusado',
        coalesce(new.motivo, 'sem motivo informado') || ' · ' || resumo, '#/paraquedas', new.id);
    elsif new.status = 'pago' then
      perform _notificar(new.empresa_id, array[new.criado_por], 'paraquedas_pago', 'Pagamento antecipado PA nº ' || new.numero || ' pago', resumo, '#/paraquedas', new.id);
    elsif new.status = 'cancelado' then
      perform _notificar(new.empresa_id, array[new.criado_por], 'paraquedas_cancelado', 'Pagamento antecipado PA nº ' || new.numero || ' cancelado',
        coalesce(new.motivo, '') || ' · ' || resumo, '#/paraquedas', new.id);
    end if;
  end if;
  if new.comprovante_path is not null and new.comprovante_path is distinct from old.comprovante_path then
    perform _notificar(new.empresa_id, array[new.criado_por], 'paraquedas_comprovante', 'Comprovante do pagamento antecipado PA nº ' || new.numero || ' anexado', resumo, '#/paraquedas', new.id);
  end if;
  return new;
end $$;

-- ===== 20261016000038_auditoria.sql =====
-- =====================================================================
-- Auditoria: registra quem incluiu, alterou ou excluiu, quando, e os valores antes/depois
--  - só cria tabela, função e gatilhos (AFTER); não altera nenhum dado existente
--  - grava a partir de agora (o passado não é reconstruído)
--  - quem lê: administrador e diretor da empresa; ninguém grava/edita/apaga pela API
-- =====================================================================

create table if not exists public.auditoria (
  id bigserial primary key,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  user_id uuid,                              -- null = rotina do sistema / importação
  user_email text,
  tabela text not null,
  registro_id text,
  acao text not null check (acao in ('incluiu', 'alterou', 'excluiu')),
  campos text[],                             -- campos alterados (só em "alterou")
  antes jsonb,
  depois jsonb,
  criado_em timestamptz not null default now()
);
create index if not exists auditoria_emp_data on public.auditoria(empresa_id, criado_em desc);
create index if not exists auditoria_registro on public.auditoria(tabela, registro_id, criado_em desc);
create index if not exists auditoria_user on public.auditoria(empresa_id, user_id, criado_em desc);

alter table public.auditoria enable row level security;
drop policy if exists auditoria_sel on public.auditoria;
create policy auditoria_sel on public.auditoria for select to authenticated using (
  exists (select 1 from public.membros m where m.empresa_id = auditoria.empresa_id and m.user_id = (select auth.uid())
          and m.papel::text in ('admin', 'diretor')));
revoke all on public.auditoria from anon, authenticated;
grant select on public.auditoria to authenticated;

create or replace function public._auditar() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  r_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  r jsonb := coalesce(r_new, r_old);
  v_emp uuid := (r ->> 'empresa_id')::uuid;
  v_reg text := coalesce(r ->> 'id', r ->> 'plano_id', r ->> 'conta_bancaria_id',
                         (r ->> 'favorecido_id') || coalesce(':' || (r ->> 'papel'), ''), r ->> 'user_id');
  ign text[] := array['updated_at', 'created_at', 'atualizado_em', 'criado_em', 'xml'];
  k text; mudou text[] := '{}'; a jsonb := '{}'; d jsonb := '{}';
begin
  if v_emp is null then return null; end if;
  if tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(r_new) loop
      if k = any(ign) then continue; end if;
      if (r_old -> k) is distinct from (r_new -> k) then
        mudou := mudou || k; a := a || jsonb_build_object(k, r_old -> k); d := d || jsonb_build_object(k, r_new -> k);
      end if;
    end loop;
    if cardinality(mudou) = 0 then return null; end if;   -- update sem mudança real
    insert into auditoria(empresa_id, user_id, user_email, tabela, registro_id, acao, campos, antes, depois)
    values (v_emp, auth.uid(), auth.jwt() ->> 'email', tg_table_name, v_reg, 'alterou', mudou, a, d);
  else
    insert into auditoria(empresa_id, user_id, user_email, tabela, registro_id, acao, antes, depois)
    values (v_emp, auth.uid(), auth.jwt() ->> 'email', tg_table_name, v_reg,
            case tg_op when 'INSERT' then 'incluiu' else 'excluiu' end,
            case when tg_op = 'DELETE' then r_old - ign end, case when tg_op = 'INSERT' then r_new - ign end);
  end if;
  return null;
end $$;
revoke all on function public._auditar() from public, anon, authenticated;

-- liga a auditoria nas tabelas de movimento e de cadastro
do $$
declare t text;
begin
  foreach t in array array['lancamentos', 'contas', 'favorecidos', 'plano_contas', 'centros_custo', 'grupos', 'orcamentos',
                           'orcamento_rateio_cc', 'paraquedas', 'fidc_propostas', 'contas_travas', 'conciliacoes', 'conferencias_dia',
                           'membros', 'creditos', 'duplicatas', 'autorizacoes', 'nfe_vinculos',
                           'contab_depara_plano', 'contab_depara_conta', 'contab_depara_favorecido'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists zz_auditoria on public.%I', t);
      execute format('create trigger zz_auditoria after insert or update or delete on public.%I for each row execute function public._auditar()', t);
    end if;
  end loop;
end $$;

-- ===== 20261016000039_caixa_compromissos.sql =====
-- =====================================================================
-- Necessidade de caixa: compromissos programados (ex.: parcela mensal da Recuperação Judicial,
-- quando definida pelo Administrador Judicial). Só cria a tabela; nada existente é alterado.
-- =====================================================================
create table if not exists public.caixa_compromissos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  descricao text not null,
  natureza char(1) not null default 'S' check (natureza in ('S', 'E')),   -- S = saída, E = entrada
  valor numeric(16,2) not null check (valor > 0),
  dia smallint not null check (dia between 1 and 31),                      -- dia do mês (último dia se o mês for menor)
  inicio date not null,
  fim date,
  ativo boolean not null default true,
  observacao text,
  criado_por uuid default auth.uid(),
  criado_em timestamptz not null default now()
);
create index if not exists caixa_compromissos_emp on public.caixa_compromissos(empresa_id);
alter table public.caixa_compromissos enable row level security;
drop policy if exists caixa_compromissos_sel on public.caixa_compromissos;
drop policy if exists caixa_compromissos_ins on public.caixa_compromissos;
drop policy if exists caixa_compromissos_upd on public.caixa_compromissos;
drop policy if exists caixa_compromissos_del on public.caixa_compromissos;
create policy caixa_compromissos_sel on public.caixa_compromissos for select to authenticated using (public.is_membro(empresa_id));
create policy caixa_compromissos_ins on public.caixa_compromissos for insert to authenticated with check (public.pode_editar(empresa_id));
create policy caixa_compromissos_upd on public.caixa_compromissos for update to authenticated using (public.pode_editar(empresa_id)) with check (public.pode_editar(empresa_id));
create policy caixa_compromissos_del on public.caixa_compromissos for delete to authenticated using (public.pode_editar(empresa_id));
grant select, insert, update, delete on public.caixa_compromissos to authenticated;

-- entra na auditoria (migração 038)
drop trigger if exists zz_auditoria on public.caixa_compromissos;
create trigger zz_auditoria after insert or update or delete on public.caixa_compromissos for each row execute function public._auditar();

-- ===== 20261016000040_compras.sql =====
-- =====================================================================
-- Etapa 2 — Compras: requisição → aprovação → cotação → pedido (alçada) → previsão no contas a pagar
-- → recebimento casado com a NF-e de entrada → parcelas da nota no contas a pagar.
-- Migração ADITIVA: só cria tabelas, funções e gatilhos novos. Nenhuma tabela existente é alterada.
-- Os lançamentos criados pelo módulo ficam ligados ao pedido em compras_pedido_lancamentos.
-- =====================================================================

-- ---------- quem pode o quê ----------
-- opera o módulo: admin, financeiro, diretor e compras
create or replace function public.pode_comprar(p_empresa uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from membros where empresa_id = p_empresa and user_id = auth.uid()
                and papel::text in ('admin', 'financeiro', 'diretor', 'compras'));
$$;
-- aprova requisição e pedido acima da alçada: admin e diretor
create or replace function public.pode_aprovar_compra(p_empresa uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from membros where empresa_id = p_empresa and user_id = auth.uid()
                and papel::text in ('admin', 'diretor'));
$$;

-- ---------- parâmetros ----------
create table if not exists public.compras_parametros (
  empresa_id uuid primary key references public.empresas(id) on delete cascade,
  alcada_valor numeric(16,2) not null default 5000,          -- pedido acima disso precisa de admin/diretor
  previsao_automatica boolean not null default true,         -- pedido aprovado gera previsão no contas a pagar
  atualizado_em timestamptz not null default now()
);

-- ---------- requisições ----------
create table if not exists public.compras_requisicoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  numero int not null default 0,
  solicitante text,
  centro_custo_id uuid references public.centros_custo(id) on delete set null,
  necessidade date,
  prioridade text not null default 'normal' check (prioridade in ('normal', 'urgente')),
  status text not null default 'pendente' check (status in ('pendente', 'aprovada', 'rejeitada', 'atendida', 'cancelada')),
  observacao text,
  motivo text,
  criado_por uuid default auth.uid(),
  criado_em timestamptz not null default now(),
  decidido_por uuid references auth.users(id),
  decidido_em timestamptz,
  unique (empresa_id, numero)
);
create table if not exists public.compras_requisicao_itens (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  requisicao_id uuid not null references public.compras_requisicoes(id) on delete cascade,
  descricao text not null,
  unidade text not null default 'UN',
  quantidade numeric(16,4) not null check (quantidade > 0),
  valor_estimado numeric(16,4),                      -- unitário estimado (opcional)
  ncm text,
  observacao text
);
create index if not exists compras_req_emp on public.compras_requisicoes(empresa_id, status);
create index if not exists compras_req_itens_req on public.compras_requisicao_itens(requisicao_id);

-- ---------- cotações ----------
create table if not exists public.compras_cotacoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  requisicao_id uuid not null references public.compras_requisicoes(id) on delete cascade,
  favorecido_id uuid references public.favorecidos(id) on delete set null,
  fornecedor text not null,                           -- nome como veio na proposta (fornecedor pode não ter cadastro ainda)
  prazo_entrega_dias int,
  condicao_pagamento text,
  parcelas_dias int[] not null default '{28}',
  frete numeric(16,2) not null default 0,
  validade date,
  escolhida boolean not null default false,
  observacao text,
  criado_por uuid default auth.uid(),
  criado_em timestamptz not null default now()
);
create table if not exists public.compras_cotacao_itens (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  cotacao_id uuid not null references public.compras_cotacoes(id) on delete cascade,
  requisicao_item_id uuid not null references public.compras_requisicao_itens(id) on delete cascade,
  valor_unitario numeric(16,4) not null check (valor_unitario >= 0),
  unique (cotacao_id, requisicao_item_id)
);
create index if not exists compras_cot_req on public.compras_cotacoes(requisicao_id);
create index if not exists compras_cot_itens_cot on public.compras_cotacao_itens(cotacao_id);

-- ---------- pedidos ----------
create table if not exists public.compras_pedidos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  numero int not null default 0,
  favorecido_id uuid not null references public.favorecidos(id),
  data_pedido date not null default current_date,
  entrega_prevista date,
  condicao_pagamento text,
  parcelas_dias int[] not null default '{28}',        -- dias após a entrega prevista (ou a data do pedido)
  plano_id uuid references public.plano_contas(id) on delete set null,
  centro_custo_id uuid references public.centros_custo(id) on delete set null,
  frete numeric(16,2) not null default 0,
  desconto numeric(16,2) not null default 0,
  total numeric(16,2) not null default 0,             -- calculado: itens + frete − desconto
  status text not null default 'rascunho' check (status in ('rascunho', 'aguardando', 'aprovado', 'enviado', 'recebido_parcial', 'recebido', 'cancelado')),
  pedido_iniflex text,                                -- número do pedido no Iniflex (referência)
  requisicao_id uuid references public.compras_requisicoes(id) on delete set null,
  cotacao_id uuid references public.compras_cotacoes(id) on delete set null,
  observacao text,
  motivo text,
  criado_por uuid default auth.uid(),
  criado_em timestamptz not null default now(),
  aprovado_por uuid references auth.users(id),
  aprovado_em timestamptz,
  unique (empresa_id, numero)
);
create table if not exists public.compras_pedido_itens (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  pedido_id uuid not null references public.compras_pedidos(id) on delete cascade,
  requisicao_item_id uuid references public.compras_requisicao_itens(id) on delete set null,
  descricao text not null,
  unidade text not null default 'UN',
  ncm text,
  quantidade numeric(16,4) not null check (quantidade > 0),
  valor_unitario numeric(16,4) not null default 0 check (valor_unitario >= 0),
  qtd_recebida numeric(16,4) not null default 0
);
create index if not exists compras_ped_emp on public.compras_pedidos(empresa_id, status);
create index if not exists compras_ped_fav on public.compras_pedidos(favorecido_id);
create index if not exists compras_ped_itens_ped on public.compras_pedido_itens(pedido_id);

-- ---------- recebimentos ----------
create table if not exists public.compras_recebimentos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  pedido_id uuid not null references public.compras_pedidos(id) on delete cascade,
  nfe_nota_id uuid references public.nfe_notas(id) on delete set null,
  data date not null default current_date,
  divergencias jsonb not null default '[]'::jsonb,   -- fotografia da conferência pedido × nota
  observacao text,
  criado_por uuid default auth.uid(),
  criado_em timestamptz not null default now()
);
create table if not exists public.compras_recebimento_itens (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  recebimento_id uuid not null references public.compras_recebimentos(id) on delete cascade,
  pedido_item_id uuid not null references public.compras_pedido_itens(id) on delete cascade,
  nfe_item_id uuid references public.nfe_itens(id) on delete set null,
  quantidade numeric(16,4) not null check (quantidade > 0),
  valor_unitario numeric(16,4)
);
create index if not exists compras_rec_ped on public.compras_recebimentos(pedido_id);
create index if not exists compras_rec_nota on public.compras_recebimentos(nfe_nota_id);
create index if not exists compras_rec_itens_rec on public.compras_recebimento_itens(recebimento_id);

-- ---------- pedido × lançamentos (previsão e parcelas da nota) ----------
create table if not exists public.compras_pedido_lancamentos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  pedido_id uuid not null references public.compras_pedidos(id) on delete cascade,
  lancamento_id uuid not null references public.lancamentos(id) on delete cascade,
  tipo text not null check (tipo in ('previsao', 'nota')),
  criado_em timestamptz not null default now(),
  unique (lancamento_id)
);
create index if not exists compras_ped_lanc_ped on public.compras_pedido_lancamentos(pedido_id);

-- ---------- numeração ----------
create or replace function public._compras_numero() returns trigger language plpgsql as $$
begin
  if coalesce(new.numero, 0) = 0 then
    execute format('select coalesce(max(numero), 0) + 1 from %I.%I where empresa_id = $1', tg_table_schema, tg_table_name)
      into new.numero using new.empresa_id;
  end if;
  return new;
end $$;
drop trigger if exists compras_req_numero on public.compras_requisicoes;
create trigger compras_req_numero before insert on public.compras_requisicoes for each row execute function public._compras_numero();
drop trigger if exists compras_ped_numero on public.compras_pedidos;
create trigger compras_ped_numero before insert on public.compras_pedidos for each row execute function public._compras_numero();

-- ---------- regras da requisição ----------
create or replace function public._compras_req_regras() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    if new.status in ('aprovada', 'rejeitada') then
      if old.status <> 'pendente' then raise exception 'Só requisição pendente pode ser aprovada ou rejeitada.'; end if;
      if not pode_aprovar_compra(new.empresa_id) then raise exception 'Só a direção (admin ou diretor) aprova ou rejeita requisição.'; end if;
      if new.status = 'rejeitada' and coalesce(trim(new.motivo), '') = '' then raise exception 'Informe o motivo da rejeição.'; end if;
      new.decidido_por := auth.uid(); new.decidido_em := now();
    elsif new.status = 'pendente' then
      if old.status <> 'rejeitada' then raise exception 'Mudança de situação não permitida: % → %', old.status, new.status; end if;
      new.decidido_por := null; new.decidido_em := null;            -- reenviada depois de corrigida
    elsif new.status = 'atendida' then
      if old.status <> 'aprovada' then raise exception 'Só requisição aprovada vira pedido.'; end if;
    elsif new.status = 'cancelada' then
      if old.status = 'atendida' then raise exception 'Requisição já atendida por pedido não pode ser cancelada.'; end if;
    else
      raise exception 'Mudança de situação não permitida: % → %', old.status, new.status;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists compras_req_regras on public.compras_requisicoes;
create trigger compras_req_regras before update on public.compras_requisicoes for each row execute function public._compras_req_regras();

-- ---------- total do pedido ----------
create or replace function public._compras_total_itens(p_pedido uuid) returns numeric
language sql stable set search_path = public as $$
  select coalesce(round(sum(quantidade * valor_unitario), 2), 0) from compras_pedido_itens where pedido_id = p_pedido;
$$;
create or replace function public._compras_itens_total() returns trigger
language plpgsql security definer set search_path = public as $$
declare pid uuid := coalesce(new.pedido_id, old.pedido_id); st text;
begin
  select status into st from compras_pedidos where id = pid;
  -- itens só mudam com o pedido em rascunho ou aguardando (a quantidade recebida é atualizada pelo recebimento)
  if st not in ('rascunho', 'aguardando') and not (tg_op = 'UPDATE' and new.quantidade = old.quantidade and new.valor_unitario = old.valor_unitario
      and new.descricao = old.descricao) then
    raise exception 'Pedido já aprovado: itens não podem mudar. Volte o pedido para rascunho (se não tiver recebimento) ou cancele.';
  end if;
  update compras_pedidos set total = _compras_total_itens(pid) + frete - desconto where id = pid;
  return null;
end $$;
drop trigger if exists compras_itens_total on public.compras_pedido_itens;
create trigger compras_itens_total after insert or update or delete on public.compras_pedido_itens for each row execute function public._compras_itens_total();

-- ---------- previsão no contas a pagar ----------
-- refaz a previsão do pedido pelo valor ainda não recebido: apaga as previsões em aberto e cria de novo pelas parcelas.
create or replace function public._compras_refazer_previsao(p_pedido uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  p compras_pedidos; f text; base date; tot_itens numeric; rec_itens numeric; restante numeric; pagos numeric;
  n int; i int; parc numeric; acum numeric := 0; lid uuid;
begin
  select * into p from compras_pedidos where id = p_pedido;
  delete from lancamentos where id in (select lancamento_id from compras_pedido_lancamentos where pedido_id = p_pedido and tipo = 'previsao')
     and status = 'Em aberto';
  if p.status not in ('aprovado', 'enviado', 'recebido_parcial') or p.plano_id is null then return; end if;
  if not coalesce((select previsao_automatica from compras_parametros where empresa_id = p.empresa_id), true) then return; end if;
  select coalesce(sum(quantidade * valor_unitario), 0), coalesce(sum(least(qtd_recebida, quantidade) * valor_unitario), 0)
    into tot_itens, rec_itens from compras_pedido_itens where pedido_id = p_pedido;
  restante := case when tot_itens > 0 then round(p.total * (1 - rec_itens / tot_itens), 2) else p.total end;
  select coalesce(sum(l.valor), 0) into pagos from compras_pedido_lancamentos pl join lancamentos l on l.id = pl.lancamento_id
    where pl.pedido_id = p_pedido and pl.tipo = 'previsao';                      -- previsão que alguém baixou como paga continua valendo
  restante := restante - pagos;
  if restante <= 0 then return; end if;
  select nome into f from favorecidos where id = p.favorecido_id;
  base := coalesce(p.entrega_prevista, p.data_pedido);
  n := greatest(coalesce(array_length(p.parcelas_dias, 1), 0), 1);
  for i in 1..n loop
    parc := case when i = n then restante - acum else round(restante / n, 2) end;
    acum := acum + parc;
    insert into lancamentos (empresa_id, data, plano_id, descricao, favorecido_id, centro_custo_id, status, valor, origem, documento)
    values (p.empresa_id, base + coalesce(p.parcelas_dias[i], 0), p.plano_id,
            left(format('PC %s — %s — previsão de compra%s', p.numero, f, case when n > 1 then format(' (%s/%s)', i, n) else '' end), 250),
            p.favorecido_id, p.centro_custo_id, 'Em aberto', parc, 'compras:previsao', 'PC ' || p.numero)
    returning id into lid;
    insert into compras_pedido_lancamentos (empresa_id, pedido_id, lancamento_id, tipo) values (p.empresa_id, p_pedido, lid, 'previsao');
  end loop;
end $$;
revoke all on function public._compras_refazer_previsao(uuid) from public, anon, authenticated;

-- ---------- regras do pedido ----------
create or replace function public._compras_ped_regras() returns trigger
language plpgsql security definer set search_path = public as $$
declare alc numeric; tem_rec boolean;
begin
  if tg_op = 'INSERT' then
    if new.status not in ('rascunho', 'aguardando') then raise exception 'Pedido novo começa em rascunho.'; end if;
    new.total := new.frete - new.desconto;            -- os itens somam depois
    return new;
  end if;
  new.total := _compras_total_itens(new.id) + new.frete - new.desconto;
  if new.status is distinct from old.status then
    select exists(select 1 from compras_recebimentos where pedido_id = new.id) into tem_rec;
    if new.status = 'aprovado' and old.status in ('rascunho', 'aguardando') then
      if new.total <= 0 then raise exception 'Pedido sem valor.'; end if;
      if new.plano_id is null then raise exception 'Informe a classificação (plano de contas) antes de aprovar.'; end if;
      select coalesce((select alcada_valor from compras_parametros where empresa_id = new.empresa_id), 5000) into alc;
      if not (pode_aprovar_compra(new.empresa_id) or (pode_comprar(new.empresa_id) and new.total <= alc)) then
        raise exception 'Pedido de % acima da alçada de %: precisa de aprovação da direção.', replace(to_char(new.total, 'FM999999999990.00'), '.', ','), replace(to_char(alc, 'FM999999999990.00'), '.', ',');
      end if;
      new.aprovado_por := auth.uid(); new.aprovado_em := now();
    elsif new.status = 'aguardando' and old.status = 'rascunho' then null;
    elsif new.status = 'rascunho' and old.status in ('aguardando', 'aprovado', 'enviado') then
      if tem_rec then raise exception 'Pedido com recebimento não volta para rascunho.'; end if;
      new.aprovado_por := null; new.aprovado_em := null;
    elsif new.status = 'enviado' and old.status = 'aprovado' then null;
    elsif new.status in ('recebido_parcial', 'recebido') and old.status in ('aprovado', 'enviado', 'recebido_parcial') then null;
    elsif new.status = 'cancelado' then
      if old.status = 'recebido' then raise exception 'Pedido já recebido não pode ser cancelado.'; end if;
      if coalesce(trim(new.motivo), '') = '' then raise exception 'Informe o motivo do cancelamento.'; end if;
    else
      raise exception 'Mudança de situação não permitida: % → %', old.status, new.status;
    end if;
  elsif old.status not in ('rascunho', 'aguardando') and (new.favorecido_id is distinct from old.favorecido_id or new.frete is distinct from old.frete
        or new.desconto is distinct from old.desconto) then
    raise exception 'Pedido já aprovado: fornecedor e valores não mudam. Volte para rascunho ou cancele.';
  end if;
  return new;
end $$;
drop trigger if exists compras_ped_regras on public.compras_pedidos;
create trigger compras_ped_regras before insert or update on public.compras_pedidos for each row execute function public._compras_ped_regras();

-- depois de mudar situação, classificação, parcelas ou entrega: refaz a previsão
create or replace function public._compras_ped_previsao() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status or new.plano_id is distinct from old.plano_id or new.centro_custo_id is distinct from old.centro_custo_id
     or new.parcelas_dias is distinct from old.parcelas_dias or new.entrega_prevista is distinct from old.entrega_prevista or new.total is distinct from old.total then
    perform _compras_refazer_previsao(new.id);
  end if;
  return null;
end $$;
drop trigger if exists compras_ped_previsao on public.compras_pedidos;
create trigger compras_ped_previsao after update on public.compras_pedidos for each row execute function public._compras_ped_previsao();

-- ---------- RPC: cadastros que o perfil Compras precisa (ele não lê as tabelas de cadastro) ----------
create or replace function public.compras_cadastros(p_empresa uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not pode_comprar(p_empresa) then raise exception 'Sem acesso a Compras.'; end if;
  return jsonb_build_object(
    'fornecedores', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'nome', nome, 'documento', documento, 'tipo', tipo) order by nome)
                     from favorecidos where empresa_id = p_empresa and ativo and tipo not in ('CLIENTES', 'TERCEIROS - CLIENTES')), '[]'::jsonb),
    'centros', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'nome', nome) order by nome) from centros_custo where empresa_id = p_empresa), '[]'::jsonb),
    'planos', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'codigo', codigo, 'nome', nome) order by codigo)
                from plano_contas where empresa_id = p_empresa and nivel = 2 and tipo = 'S'), '[]'::jsonb),
    'parametros', coalesce((select to_jsonb(cp) from compras_parametros cp where empresa_id = p_empresa),
                           jsonb_build_object('alcada_valor', 5000, 'previsao_automatica', true)),
    'pode_aprovar', pode_aprovar_compra(p_empresa));
end $$;

-- ---------- RPC: notas de entrada candidatas ao recebimento de um pedido ----------
create or replace function public.compras_notas_candidatas(p_pedido uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare p compras_pedidos; doc text;
begin
  select * into p from compras_pedidos where id = p_pedido;
  if p.id is null or not pode_comprar(p.empresa_id) then raise exception 'Sem acesso a este pedido.'; end if;
  select regexp_replace(coalesce(documento, ''), '\D', '', 'g') into doc from favorecidos where id = p.favorecido_id;
  return coalesce((select jsonb_agg(x order by x->>'emissao' desc) from (
    select jsonb_build_object('id', n.id, 'numero', n.numero, 'serie', n.serie, 'emissao', n.emissao, 'emit_nome', n.emit_nome, 'v_nf', n.v_nf,
      'mesmo_fornecedor', (n.favorecido_id = p.favorecido_id or (doc <> '' and n.emit_doc = doc)),
      'itens', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'n_item', i.n_item, 'xprod', i.xprod, 'ucom', i.ucom, 'qcom', i.qcom, 'vuncom', i.vuncom, 'vprod', i.vprod, 'ncm', i.ncm) order by i.n_item)
                         from nfe_itens i where i.nota_id = n.id), '[]'::jsonb),
      'parcelas', coalesce((select jsonb_agg(jsonb_build_object('id', pa.id, 'numero', pa.numero, 'vencimento', pa.vencimento, 'valor', pa.valor,
                         'vinculada', exists(select 1 from nfe_vinculos v where v.parcela_id = pa.id or (v.nota_id = n.id and v.parcela_id is null))) order by pa.numero)
                         from nfe_parcelas pa where pa.nota_id = n.id), '[]'::jsonb),
      'ja_recebida', exists(select 1 from compras_recebimentos r where r.nfe_nota_id = n.id)) x
    from nfe_notas n
    where n.empresa_id = p.empresa_id and n.tipo = 'entrada' and not n.emissao_propria and n.situacao = 'autorizada'
      and n.emissao >= p.data_pedido - 30
      and (n.favorecido_id = p.favorecido_id or (doc <> '' and n.emit_doc = doc))
  ) s), '[]'::jsonb);
end $$;

-- ---------- RPC: registrar recebimento ----------
-- p_itens: [{pedido_item_id, quantidade, valor_unitario, nfe_item_id}]
-- p_lancar_parcelas: lança no contas a pagar as parcelas da nota que ainda não têm lançamento vinculado
create or replace function public.compras_receber(p_pedido uuid, p_nota uuid, p_data date, p_itens jsonb, p_divergencias jsonb,
                                                  p_lancar_parcelas boolean, p_observacao text)
returns uuid language plpgsql security definer set search_path = public as $$
declare p compras_pedidos; rid uuid; it jsonb; pi compras_pedido_itens; f text; n nfe_notas; pa record; lid uuid; falta numeric;
begin
  select * into p from compras_pedidos where id = p_pedido for update;
  if p.id is null or not pode_comprar(p.empresa_id) then raise exception 'Sem acesso a este pedido.'; end if;
  if p.status not in ('aprovado', 'enviado', 'recebido_parcial') then raise exception 'Só pedido aprovado pode ser recebido (situação atual: %).', p.status; end if;
  if p_nota is not null then
    select * into n from nfe_notas where id = p_nota and empresa_id = p.empresa_id and tipo = 'entrada';
    if n.id is null then raise exception 'Nota de entrada não encontrada.'; end if;
  end if;
  if jsonb_array_length(coalesce(p_itens, '[]'::jsonb)) = 0 then raise exception 'Informe ao menos um item recebido.'; end if;
  insert into compras_recebimentos (empresa_id, pedido_id, nfe_nota_id, data, divergencias, observacao)
  values (p.empresa_id, p.id, p_nota, coalesce(p_data, current_date), coalesce(p_divergencias, '[]'::jsonb), p_observacao) returning id into rid;
  for it in select * from jsonb_array_elements(p_itens) loop
    select * into pi from compras_pedido_itens where id = (it->>'pedido_item_id')::uuid and pedido_id = p.id;
    if pi.id is null then raise exception 'Item não pertence ao pedido.'; end if;
    if coalesce((it->>'quantidade')::numeric, 0) <= 0 then continue; end if;
    insert into compras_recebimento_itens (empresa_id, recebimento_id, pedido_item_id, nfe_item_id, quantidade, valor_unitario)
    values (p.empresa_id, rid, pi.id, nullif(it->>'nfe_item_id', '')::uuid, (it->>'quantidade')::numeric, nullif(it->>'valor_unitario', '')::numeric);
    update compras_pedido_itens set qtd_recebida = qtd_recebida + (it->>'quantidade')::numeric where id = pi.id;
  end loop;
  select coalesce(sum(greatest(quantidade - qtd_recebida, 0)), 0) into falta from compras_pedido_itens where pedido_id = p.id;
  update compras_pedidos set status = case when falta <= 0 then 'recebido' else 'recebido_parcial' end where id = p.id;   -- refaz a previsão pelo que falta
  if p_lancar_parcelas and p_nota is not null then
    select nome into f from favorecidos where id = p.favorecido_id;
    for pa in select * from nfe_parcelas where nota_id = p_nota
               and not exists (select 1 from nfe_vinculos v where v.parcela_id = nfe_parcelas.id or (v.nota_id = p_nota and v.parcela_id is null))
               order by numero loop
      insert into lancamentos (empresa_id, data, plano_id, descricao, favorecido_id, centro_custo_id, status, valor, origem, documento, emissao)
      values (p.empresa_id, coalesce(pa.vencimento, n.emissao), p.plano_id, left(format('NF %s — %s — PC %s', n.numero, f, p.numero), 250),
              p.favorecido_id, p.centro_custo_id, 'Em aberto', pa.valor, 'compras:nota', format('%s-%s', n.numero, pa.numero), n.emissao)
      returning id into lid;
      insert into nfe_vinculos (empresa_id, nota_id, parcela_id, lancamento_id, tipo) values (p.empresa_id, p_nota, pa.id, lid, 'exata');
      insert into compras_pedido_lancamentos (empresa_id, pedido_id, lancamento_id, tipo) values (p.empresa_id, p.id, lid, 'nota');
    end loop;
  end if;
  return rid;
end $$;

-- ---------- RPC: ajustar parâmetros (admin/diretor) ----------
create or replace function public.compras_salvar_parametros(p_empresa uuid, p_alcada numeric, p_previsao boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not pode_aprovar_compra(p_empresa) then raise exception 'Só admin ou diretor altera os parâmetros de Compras.'; end if;
  insert into compras_parametros (empresa_id, alcada_valor, previsao_automatica, atualizado_em) values (p_empresa, p_alcada, p_previsao, now())
  on conflict (empresa_id) do update set alcada_valor = excluded.alcada_valor, previsao_automatica = excluded.previsao_automatica, atualizado_em = now();
end $$;

revoke all on function public.compras_cadastros(uuid), public.compras_notas_candidatas(uuid),
  public.compras_receber(uuid, uuid, date, jsonb, jsonb, boolean, text), public.compras_salvar_parametros(uuid, numeric, boolean) from public, anon;
grant execute on function public.compras_cadastros(uuid), public.compras_notas_candidatas(uuid),
  public.compras_receber(uuid, uuid, date, jsonb, jsonb, boolean, text), public.compras_salvar_parametros(uuid, numeric, boolean),
  public.pode_comprar(uuid), public.pode_aprovar_compra(uuid) to authenticated;

-- ---------- acesso (RLS) ----------
do $$
declare t text;
begin
  foreach t in array array['compras_requisicoes', 'compras_requisicao_itens', 'compras_cotacoes', 'compras_cotacao_itens',
                           'compras_pedidos', 'compras_pedido_itens', 'compras_recebimentos', 'compras_recebimento_itens',
                           'compras_pedido_lancamentos', 'compras_parametros'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_sel', t);
    execute format('drop policy if exists %I on public.%I', t || '_ins', t);
    execute format('drop policy if exists %I on public.%I', t || '_upd', t);
    execute format('drop policy if exists %I on public.%I', t || '_del', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_participante(empresa_id))', t || '_sel', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
  -- requisições, cotações e pedidos: quem opera Compras escreve (as regras de situação ficam nos gatilhos)
  foreach t in array array['compras_requisicoes', 'compras_requisicao_itens', 'compras_cotacoes', 'compras_cotacao_itens',
                           'compras_pedidos', 'compras_pedido_itens'] loop
    execute format('create policy %I on public.%I for insert to authenticated with check (public.pode_comprar(empresa_id))', t || '_ins', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.pode_comprar(empresa_id)) with check (public.pode_comprar(empresa_id))', t || '_upd', t);
    execute format('grant insert, update on public.%I to authenticated', t);
  end loop;
  -- itens e cotações podem ser apagados enquanto o documento está aberto; requisição/pedido não se apagam (cancela)
  foreach t in array array['compras_requisicao_itens', 'compras_cotacoes', 'compras_cotacao_itens', 'compras_pedido_itens'] loop
    execute format('create policy %I on public.%I for delete to authenticated using (public.pode_comprar(empresa_id))', t || '_del', t);
    execute format('grant delete on public.%I to authenticated', t);
  end loop;
  -- recebimentos, vínculos e parâmetros: só pelas funções (compras_receber / compras_salvar_parametros)
end $$;

-- ---------- auditoria (migração 038) ----------
do $$
declare t text;
begin
  foreach t in array array['compras_parametros', 'compras_requisicoes', 'compras_requisicao_itens', 'compras_cotacoes', 'compras_cotacao_itens',
                           'compras_pedidos', 'compras_pedido_itens', 'compras_recebimentos', 'compras_recebimento_itens'] loop
    execute format('drop trigger if exists zz_auditoria on public.%I', t);
    execute format('create trigger zz_auditoria after insert or update or delete on public.%I for each row execute function public._auditar()', t);
  end loop;
end $$;

-- ===== 20261016000041_estoque_produto.sql =====
-- =====================================================================
-- Etapa 3 — Estoque e produto. Decisão de 16/10/2026: o estoque oficial continua no Iniflex e a plataforma
-- ESPELHA o saldo por importação periódica (posição numa data). A plataforma guarda o cadastro de produto
-- (atributos de plástico flexível), o de-para com o código de cada fornecedor, a estrutura do produto
-- e o custo de compra calculado pelas NF-e de entrada (sem os impostos recuperáveis).
-- Migração ADITIVA. Únicas alterações em tabelas existentes: coluna produto_id (opcional) nos itens de
-- requisição e de pedido do módulo Compras (criado na 040).
-- =====================================================================

-- ---------- parâmetros de custo ----------
create table if not exists public.estoque_parametros (
  empresa_id uuid primary key references public.empresas(id) on delete cascade,
  icms_recupera boolean not null default true,        -- ICMS destacado sai do custo
  pis_cofins_recupera boolean not null default true,  -- PIS/COFINS destacados saem do custo
  ipi_recupera boolean not null default true,         -- IPI destacado sai do custo (indústria que credita IPI)
  atualizado_em timestamptz not null default now()
);

-- ---------- produtos ----------
create table if not exists public.produtos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  codigo text not null,                                 -- código do Iniflex (o mesmo da NF-e de saída)
  descricao text not null,
  tipo text not null default 'materia_prima' check (tipo in ('materia_prima', 'aditivo', 'tinta_solvente', 'embalagem', 'semiacabado',
                                                                'produto_acabado', 'uso_consumo', 'peca_manutencao', 'servico', 'outro')),
  unidade text not null default 'KG',
  ncm text,
  grupo text, subgrupo text,
  -- plástico flexível
  material text,                                        -- PEBD, PEAD, PELBD, PP, BOPP, PET, ...
  largura_mm numeric(10,2), espessura_um numeric(10,2), comprimento_m numeric(12,3),
  camadas smallint check (camadas in (1, 2)),           -- 2 = tubular / saco (duas faces)
  densidade numeric(6,4),                               -- g/cm³ (PEBD ≈ 0,92; PEAD ≈ 0,95; PP ≈ 0,90)
  cor text, cores_impressao smallint, corona boolean, sanfona boolean,
  formato text check (formato in ('bobina', 'saco', 'sacola', 'folha', 'outro')),
  solda text,
  -- estoque e compra
  estoque_minimo numeric(16,3), estoque_maximo numeric(16,3), ponto_pedido numeric(16,3), lote_economico numeric(16,3),
  localizacao text,
  unidade_compra text, fator_compra numeric(16,6),      -- ex.: SC de 25 KG → fator 25
  plano_id uuid references public.plano_contas(id) on delete set null,   -- classificação padrão da compra
  ativo boolean not null default true,
  origem text not null default 'manual' check (origem in ('manual', 'nfe_saida', 'nfe_entrada', 'iniflex')),
  observacao text,
  criado_por uuid default auth.uid(),
  criado_em timestamptz not null default now(),
  unique (empresa_id, codigo)
);
create index if not exists produtos_emp_tipo on public.produtos(empresa_id, tipo);
create index if not exists produtos_emp_ncm on public.produtos(empresa_id, ncm);

-- ---------- produto × fornecedor (código do item na nota do fornecedor) ----------
create table if not exists public.produto_fornecedores (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  produto_id uuid not null references public.produtos(id) on delete cascade,
  emit_doc text not null,                               -- CNPJ do fornecedor (só dígitos, como na NF-e)
  favorecido_id uuid references public.favorecidos(id) on delete set null,
  codigo_fornecedor text not null,                      -- cProd da nota do fornecedor
  descricao_fornecedor text,
  unidade_fornecedor text,
  fator numeric(16,6) not null default 1 check (fator > 0),   -- 1 unidade do fornecedor = fator unidades do produto
  ultimo_preco numeric(20,10),                          -- custo unitário líquido na unidade do produto
  ultima_compra date,
  criado_em timestamptz not null default now(),
  unique (empresa_id, emit_doc, codigo_fornecedor)
);
create index if not exists produto_forn_prod on public.produto_fornecedores(produto_id);

-- ---------- estrutura do produto ----------
create table if not exists public.produto_estrutura (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  produto_id uuid not null references public.produtos(id) on delete cascade,     -- o que se fabrica
  componente_id uuid not null references public.produtos(id),                    -- o que se consome
  quantidade numeric(16,6) not null check (quantidade > 0),                      -- por "base" unidades do produto
  base numeric(16,3) not null default 1 check (base > 0),                         -- ex.: 1000 (por milheiro) ou 1 (por kg)
  perda_pct numeric(6,2) not null default 0 check (perda_pct >= 0 and perda_pct < 100),
  observacao text,
  unique (produto_id, componente_id),
  check (produto_id <> componente_id)
);
create index if not exists produto_estr_prod on public.produto_estrutura(produto_id);

-- ---------- espelho do estoque do Iniflex ----------
create table if not exists public.estoque_espelhos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  data_ref date not null,                               -- posição do Iniflex nesta data
  arquivo text,
  linhas int not null default 0,
  valor_total numeric(18,2),
  observacao text,
  criado_por uuid default auth.uid(),
  criado_em timestamptz not null default now()
);
create index if not exists estoque_espelhos_emp on public.estoque_espelhos(empresa_id, data_ref);
create table if not exists public.estoque_espelho_itens (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  espelho_id uuid not null references public.estoque_espelhos(id) on delete cascade,
  produto_id uuid references public.produtos(id) on delete set null,
  codigo text not null,
  descricao text,
  deposito text not null default 'GERAL',
  unidade text,
  quantidade numeric(18,4) not null,
  custo_unitario numeric(20,10),                        -- custo informado pelo Iniflex (se o relatório trouxer)
  valor numeric(18,2)
);
create index if not exists estoque_esp_itens_esp on public.estoque_espelho_itens(espelho_id);
create index if not exists estoque_esp_itens_prod on public.estoque_espelho_itens(produto_id);

-- ---------- Compras passa a apontar para o produto (opcional; o texto livre continua) ----------
alter table public.compras_requisicao_itens add column if not exists produto_id uuid references public.produtos(id) on delete set null;
alter table public.compras_pedido_itens add column if not exists produto_id uuid references public.produtos(id) on delete set null;

-- ---------- custo líquido de um item de NF-e de entrada ----------
create or replace function public.custo_item_nfe(i public.nfe_itens, p public.estoque_parametros)
returns numeric language sql immutable as $$
  select coalesce(i.vprod, 0) + coalesce(i.vfrete, 0) + coalesce(i.voutro, 0) - coalesce(i.vdesc, 0) + coalesce(i.v_st, 0)
       + case when coalesce(p.ipi_recupera, true) then 0 else coalesce(i.v_ipi, 0) end
       - case when coalesce(p.icms_recupera, true) then coalesce(i.v_icms, 0) else 0 end
       - case when coalesce(p.pis_cofins_recupera, true) then coalesce(i.v_pis, 0) + coalesce(i.v_cofins, 0) else 0 end;
$$;

-- compras por produto (pelas NF-e de entrada mapeadas no de-para): quantidade na unidade do produto e custo líquido
create or replace function public.produto_compras(p_empresa uuid, p_de date, p_ate date)
returns table(produto_id uuid, nota_id uuid, numero int, emissao date, emit_nome text, emit_doc text, codigo_fornecedor text,
              quantidade numeric, custo_total numeric, custo_unitario numeric)
language sql stable security definer set search_path = public as $$
  select pf.produto_id, n.id, n.numero, n.emissao, n.emit_nome, n.emit_doc, i.cprod,
         i.qcom * pf.fator, custo_item_nfe(i, ep), case when i.qcom * pf.fator > 0 then custo_item_nfe(i, ep) / (i.qcom * pf.fator) end
  from nfe_notas n
  join nfe_itens i on i.nota_id = n.id
  join produto_fornecedores pf on pf.empresa_id = n.empresa_id and pf.emit_doc = n.emit_doc and pf.codigo_fornecedor = i.cprod
  left join estoque_parametros ep on ep.empresa_id = n.empresa_id
  where n.empresa_id = p_empresa and is_membro(p_empresa)
    and n.tipo = 'entrada' and not n.emissao_propria and n.situacao = 'autorizada'
    and n.emissao between p_de and p_ate and coalesce(n.finalidade, '1') = '1';
$$;

-- itens de fornecedor ainda sem de-para (para a tela de de-para), agrupados por fornecedor + código
create or replace function public.produto_depara_pendente(p_empresa uuid, p_de date)
returns table(emit_doc text, emit_nome text, codigo_fornecedor text, descricao text, unidade text, ncm text,
              notas bigint, quantidade numeric, valor numeric, ultima date)
language sql stable security definer set search_path = public as $$
  select n.emit_doc, max(n.emit_nome), i.cprod, max(i.xprod), max(i.ucom), max(i.ncm), count(distinct n.id), sum(i.qcom), sum(i.vprod), max(n.emissao)
  from nfe_notas n join nfe_itens i on i.nota_id = n.id
  where n.empresa_id = p_empresa and is_membro(p_empresa)
    and n.tipo = 'entrada' and not n.emissao_propria and n.situacao = 'autorizada' and n.emissao >= p_de
    and coalesce(n.finalidade, '1') = '1' and i.cprod is not null
    and not exists (select 1 from produto_fornecedores pf where pf.empresa_id = n.empresa_id and pf.emit_doc = n.emit_doc and pf.codigo_fornecedor = i.cprod)
  group by n.emit_doc, i.cprod;
$$;

-- produtos vendidos (NF-e de saída própria) ainda não cadastrados: base do cadastro inicial de produto acabado
create or replace function public.produto_saida_pendente(p_empresa uuid, p_de date)
returns table(codigo text, descricao text, unidade text, ncm text, notas bigint, quantidade numeric, valor numeric, ultima date)
language sql stable security definer set search_path = public as $$
  select i.cprod, max(i.xprod), max(i.ucom), max(i.ncm), count(distinct n.id), sum(i.qcom), sum(i.vprod), max(n.emissao)
  from nfe_notas n join nfe_itens i on i.nota_id = n.id
  where n.empresa_id = p_empresa and is_membro(p_empresa)
    and n.tipo = 'saida' and n.emissao_propria and n.situacao = 'autorizada' and n.emissao >= p_de and i.cprod is not null
    and not exists (select 1 from produtos pr where pr.empresa_id = n.empresa_id and pr.codigo = i.cprod)
  group by i.cprod;
$$;

-- recebimento de Compras com nota: guarda o último preço no de-para do fornecedor (quando o item do pedido tem produto)
create or replace function public._estoque_preco_recebimento() returns trigger
language plpgsql security definer set search_path = public as $$
declare pi compras_pedido_itens; it nfe_itens; n nfe_notas; ep estoque_parametros; f uuid;
begin
  if new.nfe_item_id is null then return new; end if;
  select * into pi from compras_pedido_itens where id = new.pedido_item_id;
  if pi.produto_id is null then return new; end if;
  select * into it from nfe_itens where id = new.nfe_item_id;
  select * into n from nfe_notas where id = it.nota_id;
  select * into ep from estoque_parametros where empresa_id = new.empresa_id;
  select favorecido_id into f from compras_pedidos where id = pi.pedido_id;
  if it.cprod is null or n.emit_doc is null then return new; end if;
  insert into produto_fornecedores (empresa_id, produto_id, emit_doc, favorecido_id, codigo_fornecedor, descricao_fornecedor, unidade_fornecedor, fator, ultimo_preco, ultima_compra)
  values (new.empresa_id, pi.produto_id, n.emit_doc, f, it.cprod, it.xprod, it.ucom, 1,
          case when it.qcom > 0 then custo_item_nfe(it, ep) / it.qcom end, n.emissao)
  on conflict (empresa_id, emit_doc, codigo_fornecedor) do update
    set ultimo_preco = case when it.qcom > 0 then custo_item_nfe(it, ep) / (it.qcom * produto_fornecedores.fator) else produto_fornecedores.ultimo_preco end,
        ultima_compra = greatest(coalesce(produto_fornecedores.ultima_compra, n.emissao), n.emissao),
        favorecido_id = coalesce(produto_fornecedores.favorecido_id, excluded.favorecido_id);
  return new;
end $$;
drop trigger if exists estoque_preco_recebimento on public.compras_recebimento_itens;
create trigger estoque_preco_recebimento after insert on public.compras_recebimento_itens for each row execute function public._estoque_preco_recebimento();

-- importa um espelho do Iniflex de uma vez (cabeçalho + itens); liga cada linha ao produto pelo código
-- p_itens: [{codigo, descricao, deposito, unidade, quantidade, custo_unitario, valor}]
create or replace function public.estoque_importar_espelho(p_empresa uuid, p_data date, p_arquivo text, p_itens jsonb, p_observacao text)
returns uuid language plpgsql security definer set search_path = public as $$
declare eid uuid; n int;
begin
  if not pode_editar(p_empresa) and not pode_aprovar_compra(p_empresa) then raise exception 'Só admin, financeiro ou diretor importa o estoque.'; end if;
  if p_data is null then raise exception 'Informe a data da posição.'; end if;
  insert into estoque_espelhos (empresa_id, data_ref, arquivo, observacao) values (p_empresa, p_data, p_arquivo, p_observacao) returning id into eid;
  insert into estoque_espelho_itens (empresa_id, espelho_id, produto_id, codigo, descricao, deposito, unidade, quantidade, custo_unitario, valor)
  select p_empresa, eid, pr.id, x.codigo, x.descricao, coalesce(nullif(trim(x.deposito), ''), 'GERAL'), x.unidade, x.quantidade, x.custo_unitario,
         coalesce(x.valor, case when x.custo_unitario is not null then round(x.quantidade * x.custo_unitario, 2) end)
  from jsonb_to_recordset(p_itens) as x(codigo text, descricao text, deposito text, unidade text, quantidade numeric, custo_unitario numeric, valor numeric)
  left join produtos pr on pr.empresa_id = p_empresa and pr.codigo = x.codigo
  where nullif(trim(x.codigo), '') is not null and x.quantidade is not null;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'Nenhuma linha válida (código e quantidade) no arquivo.'; end if;
  update estoque_espelhos set linhas = n, valor_total = (select sum(valor) from estoque_espelho_itens where espelho_id = eid) where id = eid;
  return eid;
end $$;

-- liga as linhas de espelhos ao produto depois que o produto é cadastrado
create or replace function public._estoque_ligar_espelho() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update estoque_espelho_itens set produto_id = new.id where empresa_id = new.empresa_id and codigo = new.codigo and produto_id is null;
  return null;
end $$;
drop trigger if exists estoque_ligar_espelho on public.produtos;
create trigger estoque_ligar_espelho after insert on public.produtos for each row execute function public._estoque_ligar_espelho();

-- notas candidatas ao recebimento passam a trazer o CNPJ do emitente e o código do item (casamento pelo de-para)
create or replace function public.compras_notas_candidatas(p_pedido uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare p compras_pedidos; doc text;
begin
  select * into p from compras_pedidos where id = p_pedido;
  if p.id is null or not pode_comprar(p.empresa_id) then raise exception 'Sem acesso a este pedido.'; end if;
  select regexp_replace(coalesce(documento, ''), '\D', '', 'g') into doc from favorecidos where id = p.favorecido_id;
  return coalesce((select jsonb_agg(x order by x->>'emissao' desc) from (
    select jsonb_build_object('id', n.id, 'emit_doc', n.emit_doc, 'numero', n.numero, 'serie', n.serie, 'emissao', n.emissao, 'emit_nome', n.emit_nome, 'v_nf', n.v_nf,
      'mesmo_fornecedor', (n.favorecido_id = p.favorecido_id or (doc <> '' and n.emit_doc = doc)),
      'itens', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'cprod', i.cprod, 'n_item', i.n_item, 'xprod', i.xprod, 'ucom', i.ucom, 'qcom', i.qcom, 'vuncom', i.vuncom, 'vprod', i.vprod, 'ncm', i.ncm) order by i.n_item)
                         from nfe_itens i where i.nota_id = n.id), '[]'::jsonb),
      'parcelas', coalesce((select jsonb_agg(jsonb_build_object('id', pa.id, 'numero', pa.numero, 'vencimento', pa.vencimento, 'valor', pa.valor,
                         'vinculada', exists(select 1 from nfe_vinculos v where v.parcela_id = pa.id or (v.nota_id = n.id and v.parcela_id is null))) order by pa.numero)
                         from nfe_parcelas pa where pa.nota_id = n.id), '[]'::jsonb),
      'ja_recebida', exists(select 1 from compras_recebimentos r where r.nfe_nota_id = n.id)) x
    from nfe_notas n
    where n.empresa_id = p.empresa_id and n.tipo = 'entrada' and not n.emissao_propria and n.situacao = 'autorizada'
      and n.emissao >= p.data_pedido - 30
      and (n.favorecido_id = p.favorecido_id or (doc <> '' and n.emit_doc = doc))
  ) s), '[]'::jsonb);
end $$;

revoke all on function public.produto_compras(uuid, date, date), public.produto_depara_pendente(uuid, date), public.produto_saida_pendente(uuid, date),
  public.estoque_importar_espelho(uuid, date, text, jsonb, text) from public, anon;
grant execute on function public.produto_compras(uuid, date, date), public.produto_depara_pendente(uuid, date), public.produto_saida_pendente(uuid, date),
  public.estoque_importar_espelho(uuid, date, text, jsonb, text), public.custo_item_nfe(public.nfe_itens, public.estoque_parametros) to authenticated;

-- ---------- acesso ----------
do $$
declare t text;
begin
  foreach t in array array['estoque_parametros', 'produtos', 'produto_fornecedores', 'produto_estrutura', 'estoque_espelhos', 'estoque_espelho_itens'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;
-- leitura: todos os membros da empresa, inclusive o perfil Compras (precisa escolher o produto na requisição)
drop policy if exists produtos_sel on public.produtos;
create policy produtos_sel on public.produtos for select to authenticated using (public.is_participante(empresa_id));
drop policy if exists produto_fornecedores_sel on public.produto_fornecedores;
create policy produto_fornecedores_sel on public.produto_fornecedores for select to authenticated using (public.is_participante(empresa_id));
drop policy if exists produto_estrutura_sel on public.produto_estrutura;
create policy produto_estrutura_sel on public.produto_estrutura for select to authenticated using (public.is_participante(empresa_id));
drop policy if exists estoque_espelhos_sel on public.estoque_espelhos;
create policy estoque_espelhos_sel on public.estoque_espelhos for select to authenticated using (public.is_participante(empresa_id));
drop policy if exists estoque_espelho_itens_sel on public.estoque_espelho_itens;
create policy estoque_espelho_itens_sel on public.estoque_espelho_itens for select to authenticated using (public.is_participante(empresa_id));
drop policy if exists estoque_parametros_sel on public.estoque_parametros;
create policy estoque_parametros_sel on public.estoque_parametros for select to authenticated using (public.is_participante(empresa_id));
-- escrita do cadastro: quem opera Compras (admin, financeiro, diretor, compras)
do $$
declare t text;
begin
  foreach t in array array['produtos', 'produto_fornecedores', 'produto_estrutura'] loop
    execute format('drop policy if exists %I on public.%I', t || '_ins', t);
    execute format('drop policy if exists %I on public.%I', t || '_upd', t);
    execute format('drop policy if exists %I on public.%I', t || '_del', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.pode_comprar(empresa_id))', t || '_ins', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.pode_comprar(empresa_id)) with check (public.pode_comprar(empresa_id))', t || '_upd', t);
    execute format('create policy %I on public.%I for delete to authenticated using (public.pode_comprar(empresa_id))', t || '_del', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;
-- espelhos: entram pela função; excluir um espelho errado: admin, financeiro ou diretor
drop policy if exists estoque_espelhos_del on public.estoque_espelhos;
create policy estoque_espelhos_del on public.estoque_espelhos for delete to authenticated using (public.pode_editar(empresa_id) or public.pode_aprovar_compra(empresa_id));
grant select, delete on public.estoque_espelhos to authenticated;
grant select on public.estoque_espelho_itens, public.estoque_parametros to authenticated;
-- parâmetros de custo: admin/diretor/financeiro
drop policy if exists estoque_parametros_ins on public.estoque_parametros;
drop policy if exists estoque_parametros_upd on public.estoque_parametros;
create policy estoque_parametros_ins on public.estoque_parametros for insert to authenticated with check (public.pode_editar(empresa_id) or public.pode_aprovar_compra(empresa_id));
create policy estoque_parametros_upd on public.estoque_parametros for update to authenticated using (public.pode_editar(empresa_id) or public.pode_aprovar_compra(empresa_id)) with check (public.pode_editar(empresa_id) or public.pode_aprovar_compra(empresa_id));
grant insert, update on public.estoque_parametros to authenticated;

-- ---------- auditoria (migração 038) ----------
do $$
declare t text;
begin
  foreach t in array array['estoque_parametros', 'produtos', 'produto_fornecedores', 'produto_estrutura', 'estoque_espelhos'] loop
    execute format('drop trigger if exists zz_auditoria on public.%I', t);
    execute format('create trigger zz_auditoria after insert or update or delete on public.%I for each row execute function public._auditar()', t);
  end loop;
end $$;

-- ===== 20261016000042_comercial.sql =====
-- =====================================================================
-- Etapa 4a — Comercial: carteira de clientes, interações e agenda, funil até a proposta, propostas, metas
-- e painel pelas NF-e de saída (o pedido de venda continua no Iniflex).
-- Perfil novo "vendas" (representante): vê só a área Comercial e só os clientes da própria carteira
-- (favorecidos.representante_id = representante ligado ao usuário).
-- Migração ADITIVA, com UMA alteração em função existente: is_membro passa a excluir também o perfil
-- vendas (assim como já exclui compras) — sem isso o representante leria lançamentos, saldos etc.
-- =====================================================================

-- 1) papel novo (só texto é usado abaixo: o valor novo não pode ser usado como enum na mesma transação)
alter type public.papel_membro add value if not exists 'vendas';

-- 2) "membro" (leituras internas) exclui compras e vendas
create or replace function public.is_membro(p_empresa uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from membros where empresa_id = p_empresa and user_id = auth.uid() and papel::text not in ('compras', 'vendas'));
$$;

-- ---------- vendedores (representantes) e metas ----------
create table if not exists public.comercial_vendedores (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  nome text not null,
  representante_id uuid references public.favorecidos(id) on delete set null,   -- o representante no cadastro (favorecidos.representante_id dos clientes)
  user_id uuid references auth.users(id) on delete set null,                    -- usuário da plataforma (perfil vendas)
  email text,
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  unique (empresa_id, user_id)
);
create table if not exists public.comercial_metas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  vendedor_id uuid references public.comercial_vendedores(id) on delete cascade,   -- nulo = meta da empresa
  ano int not null, mes int not null check (mes between 1 and 12),
  valor numeric(16,2) not null check (valor >= 0)
);
create unique index if not exists comercial_metas_uk on public.comercial_metas(empresa_id, coalesce(vendedor_id, '00000000-0000-0000-0000-000000000000'::uuid), ano, mes);

-- quem é interno (vê tudo) e quem é representante
create or replace function public.comercial_interno(p_empresa uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from membros where empresa_id = p_empresa and user_id = auth.uid() and papel::text in ('admin', 'financeiro', 'diretor', 'leitura'));
$$;
create or replace function public.comercial_pode_editar(p_empresa uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from membros where empresa_id = p_empresa and user_id = auth.uid() and papel::text in ('admin', 'financeiro', 'diretor', 'vendas'));
$$;
create or replace function public.meu_vendedor(p_empresa uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select id from comercial_vendedores where empresa_id = p_empresa and user_id = auth.uid() and ativo limit 1;
$$;
-- o cliente está na carteira de quem consulta? (interno: todos)
create or replace function public.comercial_ve_cliente(p_empresa uuid, p_fav uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select comercial_interno(p_empresa) or exists(
    select 1 from favorecidos f join comercial_vendedores v on v.representante_id = f.representante_id
    where f.id = p_fav and f.empresa_id = p_empresa and v.user_id = auth.uid() and v.ativo);
$$;

-- ---------- interações e agenda ----------
create table if not exists public.comercial_interacoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  favorecido_id uuid references public.favorecidos(id) on delete cascade,
  oportunidade_id uuid,                                  -- (ligada ao funil, quando for de uma oportunidade)
  tipo text not null default 'anotacao' check (tipo in ('ligacao', 'visita', 'email', 'whatsapp', 'reuniao', 'anotacao')),
  data timestamptz not null default now(),
  resumo text not null,
  proximo_contato date,
  proximo_assunto text,
  concluido boolean not null default false,              -- o "próximo contato" já foi feito
  vendedor_id uuid references public.comercial_vendedores(id) on delete set null,
  criado_por uuid default auth.uid(),
  criado_em timestamptz not null default now()
);
create index if not exists comercial_int_fav on public.comercial_interacoes(favorecido_id, data desc);
create index if not exists comercial_int_agenda on public.comercial_interacoes(empresa_id, proximo_contato) where not concluido;

-- ---------- funil (oportunidades) ----------
create table if not exists public.comercial_oportunidades (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  numero int not null default 0,
  favorecido_id uuid references public.favorecidos(id) on delete set null,
  prospect text,                                         -- cliente ainda não cadastrado
  contato text,
  vendedor_id uuid references public.comercial_vendedores(id) on delete set null,
  titulo text not null,
  etapa text not null default 'contato' check (etapa in ('contato', 'qualificado', 'proposta', 'ganha', 'perdida')),
  valor_estimado numeric(16,2),
  probabilidade smallint check (probabilidade between 0 and 100),
  previsao_fechamento date,
  motivo_perda text,
  pedido_iniflex text,                                   -- quando ganha: nº do pedido no Iniflex
  observacao text,
  criado_por uuid default auth.uid(),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  fechado_em timestamptz,
  unique (empresa_id, numero),
  check (favorecido_id is not null or coalesce(trim(prospect), '') <> '')
);
create index if not exists comercial_op_emp on public.comercial_oportunidades(empresa_id, etapa);

-- ---------- propostas ----------
create table if not exists public.comercial_propostas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  oportunidade_id uuid not null references public.comercial_oportunidades(id) on delete cascade,
  numero int not null default 0,
  data date not null default current_date,
  validade date,
  condicao_pagamento text,
  prazo_entrega text,
  frete text check (frete in ('CIF', 'FOB')),
  observacao text,
  status text not null default 'rascunho' check (status in ('rascunho', 'enviada', 'aceita', 'recusada')),
  total numeric(16,2) not null default 0,
  criado_por uuid default auth.uid(),
  criado_em timestamptz not null default now(),
  unique (empresa_id, numero)
);
create table if not exists public.comercial_proposta_itens (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  proposta_id uuid not null references public.comercial_propostas(id) on delete cascade,
  produto_id uuid references public.produtos(id) on delete set null,
  descricao text not null,
  material text, largura_mm numeric(10,2), espessura_um numeric(10,2), comprimento_m numeric(12,3), camadas smallint,
  cores_impressao smallint, especificacao text,
  quantidade numeric(16,3) not null check (quantidade > 0),
  unidade text not null default 'KG' check (unidade in ('KG', 'MIL', 'UN', 'M')),   -- unidade do preço
  preco numeric(16,4) not null check (preco >= 0),
  custo_estimado numeric(16,4)                            -- por unidade de preço (calculadora), só interno
);
create index if not exists comercial_prop_op on public.comercial_propostas(oportunidade_id);
create index if not exists comercial_prop_itens_p on public.comercial_proposta_itens(proposta_id);

-- numeração (reaproveita a função da 040) e totais
drop trigger if exists comercial_op_numero on public.comercial_oportunidades;
create trigger comercial_op_numero before insert on public.comercial_oportunidades for each row execute function public._compras_numero();
drop trigger if exists comercial_prop_numero on public.comercial_propostas;
create trigger comercial_prop_numero before insert on public.comercial_propostas for each row execute function public._compras_numero();

create or replace function public._comercial_op_regras() returns trigger language plpgsql as $$
begin
  new.atualizado_em := now();
  if new.etapa = 'perdida' and coalesce(trim(new.motivo_perda), '') = '' then raise exception 'Informe o motivo da perda.'; end if;
  if new.etapa in ('ganha', 'perdida') and (tg_op = 'INSERT' or old.etapa not in ('ganha', 'perdida')) then new.fechado_em := now(); end if;
  if new.etapa not in ('ganha', 'perdida') then new.fechado_em := null; end if;
  if tg_op = 'INSERT' and new.vendedor_id is null then new.vendedor_id := meu_vendedor(new.empresa_id); end if;
  return new;
end $$;
drop trigger if exists comercial_op_regras on public.comercial_oportunidades;
create trigger comercial_op_regras before insert or update on public.comercial_oportunidades for each row execute function public._comercial_op_regras();

create or replace function public._comercial_prop_total() returns trigger language plpgsql security definer set search_path = public as $$
declare pid uuid := coalesce(new.proposta_id, old.proposta_id);
begin
  update comercial_propostas set total = coalesce((select round(sum(quantidade * preco), 2) from comercial_proposta_itens where proposta_id = pid), 0) where id = pid;
  return null;
end $$;
drop trigger if exists comercial_prop_total on public.comercial_proposta_itens;
create trigger comercial_prop_total after insert or update or delete on public.comercial_proposta_itens for each row execute function public._comercial_prop_total();

create or replace function public._comercial_int_vendedor() returns trigger language plpgsql as $$
begin
  if new.vendedor_id is null then new.vendedor_id := meu_vendedor(new.empresa_id); end if;
  return new;
end $$;
drop trigger if exists comercial_int_vendedor on public.comercial_interacoes;
create trigger comercial_int_vendedor before insert on public.comercial_interacoes for each row execute function public._comercial_int_vendedor();

-- ---------- RPCs de leitura (o perfil vendas não lê favorecidos, notas nem lançamentos direto) ----------
-- carteira: clientes visíveis com dados seguros
create or replace function public.comercial_clientes(p_empresa uuid)
returns table(id uuid, nome text, nome_fantasia text, documento text, segmento text, representante_id uuid, representante text,
              limite_credito numeric, prazo_padrao text, email text, telefone text, ativo boolean)
language sql stable security definer set search_path = public as $$
  select f.id, f.nome, f.nome_fantasia, f.documento, f.segmento, f.representante_id, r.nome, f.limite_credito, f.prazo_padrao, f.email, f.telefone, f.ativo
  from favorecidos f left join favorecidos r on r.id = f.representante_id
  where f.empresa_id = p_empresa and f.tipo in ('CLIENTES', 'TERCEIROS - CLIENTES')
    and (comercial_interno(p_empresa) or exists(select 1 from comercial_vendedores v where v.empresa_id = p_empresa and v.user_id = auth.uid() and v.ativo and v.representante_id = f.representante_id));
$$;

-- faturamento por nota (NF-e de saída de venda autorizadas), ligado ao cliente pelo cadastro ou pelo CNPJ
create or replace function public.comercial_notas(p_empresa uuid, p_de date, p_ate date)
returns table(nota_id uuid, numero int, emissao date, favorecido_id uuid, dest_doc text, dest_nome text, dest_uf text, valor numeric, representante_id uuid)
language sql stable security definer set search_path = public as $$
  with n as (
    select n.*, coalesce(n.favorecido_id, (select f.id from favorecidos f where f.empresa_id = n.empresa_id and f.tipo in ('CLIENTES', 'TERCEIROS - CLIENTES')
                                           and regexp_replace(coalesce(f.documento, ''), '\D', '', 'g') = n.dest_doc limit 1)) fav
    from nfe_notas n
    where n.empresa_id = p_empresa and n.tipo = 'saida' and n.emissao_propria and n.situacao = 'autorizada' and coalesce(n.finalidade, '1') = '1'
      and n.emissao between p_de and p_ate and not exists (select 1 from jsonb_array_elements(n.eventos) e where e->>'tipo' = 'devolucao_total'))
  select n.id, n.numero, n.emissao, n.fav, n.dest_doc, n.dest_nome, n.dest_uf, n.v_nf, f.representante_id
  from n left join favorecidos f on f.id = n.fav
  where comercial_interno(p_empresa) or exists(select 1 from comercial_vendedores v where v.empresa_id = p_empresa and v.user_id = auth.uid() and v.ativo and v.representante_id = f.representante_id);
$$;

-- itens vendidos por cliente × produto × mês
create or replace function public.comercial_itens(p_empresa uuid, p_de date, p_ate date)
returns table(favorecido_id uuid, dest_doc text, mes date, codigo text, descricao text, unidade text, quantidade numeric, valor numeric)
language sql stable security definer set search_path = public as $$
  select c.favorecido_id, c.dest_doc, date_trunc('month', c.emissao)::date, i.cprod, max(i.xprod), max(i.ucom), sum(i.qcom), sum(i.vprod)
  from comercial_notas(p_empresa, p_de, p_ate) c join nfe_itens i on i.nota_id = c.nota_id
  group by 1, 2, 3, 4;
$$;

-- situação financeira do cliente: em aberto (sem dados de fundo/borderô) e atraso médio de pagamento das parcelas das notas
create or replace function public.comercial_cliente_financeiro(p_empresa uuid, p_fav uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  if not comercial_ve_cliente(p_empresa, p_fav) then raise exception 'Cliente fora da sua carteira.'; end if;
  select jsonb_build_object(
    'abertos', coalesce((select jsonb_agg(jsonb_build_object('data', l.data, 'valor', l.valor, 'documento', l.documento, 'endossado', l.fidc_proposta_id is not null) order by l.data)
               from lancamentos l join plano_contas p on p.id = l.plano_id
               where l.empresa_id = p_empresa and l.favorecido_id = p_fav and l.status = 'Em aberto' and p.tipo = 'E'), '[]'::jsonb),
    'atraso', (select jsonb_build_object('parcelas', count(*), 'dias_medio', round(avg(l.data - pa.vencimento)::numeric, 1), 'pontual_pct', round(100.0 * count(*) filter (where l.data <= pa.vencimento) / nullif(count(*), 0), 1))
               from nfe_vinculos v join nfe_parcelas pa on pa.id = v.parcela_id join nfe_notas n on n.id = v.nota_id join lancamentos l on l.id = v.lancamento_id
               where v.empresa_id = p_empresa and l.status = 'Pago' and n.tipo = 'saida' and pa.vencimento is not null
                 and (n.favorecido_id = p_fav or l.favorecido_id = p_fav) and l.data >= current_date - 365)) into r;
  return r;
end $$;

revoke all on function public.comercial_clientes(uuid), public.comercial_notas(uuid, date, date), public.comercial_itens(uuid, date, date),
  public.comercial_cliente_financeiro(uuid, uuid) from public, anon;
grant execute on function public.comercial_clientes(uuid), public.comercial_notas(uuid, date, date), public.comercial_itens(uuid, date, date),
  public.comercial_cliente_financeiro(uuid, uuid), public.comercial_interno(uuid), public.comercial_pode_editar(uuid), public.meu_vendedor(uuid),
  public.comercial_ve_cliente(uuid, uuid) to authenticated;

-- ---------- acesso ----------
alter table public.comercial_vendedores enable row level security;
alter table public.comercial_metas enable row level security;
alter table public.comercial_interacoes enable row level security;
alter table public.comercial_oportunidades enable row level security;
alter table public.comercial_propostas enable row level security;
alter table public.comercial_proposta_itens enable row level security;

-- vendedores e metas: todos da empresa leem; admin/diretor mantêm
drop policy if exists comercial_vendedores_sel on public.comercial_vendedores;
drop policy if exists comercial_vendedores_all on public.comercial_vendedores;
create policy comercial_vendedores_sel on public.comercial_vendedores for select to authenticated using (public.is_participante(empresa_id));
create policy comercial_vendedores_all on public.comercial_vendedores for all to authenticated using (public.pode_aprovar_compra(empresa_id)) with check (public.pode_aprovar_compra(empresa_id));
drop policy if exists comercial_metas_sel on public.comercial_metas;
drop policy if exists comercial_metas_all on public.comercial_metas;
create policy comercial_metas_sel on public.comercial_metas for select to authenticated using (public.comercial_interno(empresa_id) or vendedor_id = public.meu_vendedor(empresa_id));
create policy comercial_metas_all on public.comercial_metas for all to authenticated using (public.pode_aprovar_compra(empresa_id)) with check (public.pode_aprovar_compra(empresa_id));

-- interações: interno vê tudo; representante vê as da carteira dele e as que ele mesmo registrou
drop policy if exists comercial_int_sel on public.comercial_interacoes;
drop policy if exists comercial_int_ins on public.comercial_interacoes;
drop policy if exists comercial_int_upd on public.comercial_interacoes;
drop policy if exists comercial_int_del on public.comercial_interacoes;
create policy comercial_int_sel on public.comercial_interacoes for select to authenticated
  using (public.comercial_interno(empresa_id) or criado_por = (select auth.uid()) or (favorecido_id is not null and public.comercial_ve_cliente(empresa_id, favorecido_id)));
create policy comercial_int_ins on public.comercial_interacoes for insert to authenticated
  with check (public.comercial_pode_editar(empresa_id) and (favorecido_id is null or public.comercial_ve_cliente(empresa_id, favorecido_id)));
create policy comercial_int_upd on public.comercial_interacoes for update to authenticated
  using (public.comercial_pode_editar(empresa_id) and (public.comercial_interno(empresa_id) or criado_por = (select auth.uid())))
  with check (public.comercial_pode_editar(empresa_id));
create policy comercial_int_del on public.comercial_interacoes for delete to authenticated
  using (public.comercial_pode_editar(empresa_id) and (public.comercial_interno(empresa_id) or criado_por = (select auth.uid())));

-- oportunidades: interno vê tudo; representante vê as dele
drop policy if exists comercial_op_sel on public.comercial_oportunidades;
drop policy if exists comercial_op_ins on public.comercial_oportunidades;
drop policy if exists comercial_op_upd on public.comercial_oportunidades;
create policy comercial_op_sel on public.comercial_oportunidades for select to authenticated
  using (public.comercial_interno(empresa_id) or vendedor_id = public.meu_vendedor(empresa_id));
create policy comercial_op_ins on public.comercial_oportunidades for insert to authenticated
  with check (public.comercial_pode_editar(empresa_id) and (favorecido_id is null or public.comercial_ve_cliente(empresa_id, favorecido_id)));
create policy comercial_op_upd on public.comercial_oportunidades for update to authenticated
  using (public.comercial_pode_editar(empresa_id) and (public.comercial_interno(empresa_id) or vendedor_id = public.meu_vendedor(empresa_id)))
  with check (public.comercial_pode_editar(empresa_id) and (public.comercial_interno(empresa_id) or vendedor_id = public.meu_vendedor(empresa_id)));

-- propostas e itens seguem a oportunidade
create or replace function public.comercial_ve_oportunidade(p_op uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from comercial_oportunidades o where o.id = p_op
    and (comercial_interno(o.empresa_id) or o.vendedor_id = meu_vendedor(o.empresa_id)));
$$;
grant execute on function public.comercial_ve_oportunidade(uuid) to authenticated;
drop policy if exists comercial_prop_sel on public.comercial_propostas;
drop policy if exists comercial_prop_ins on public.comercial_propostas;
drop policy if exists comercial_prop_upd on public.comercial_propostas;
drop policy if exists comercial_prop_del on public.comercial_propostas;
create policy comercial_prop_sel on public.comercial_propostas for select to authenticated using (public.comercial_ve_oportunidade(oportunidade_id));
create policy comercial_prop_ins on public.comercial_propostas for insert to authenticated with check (public.comercial_pode_editar(empresa_id) and public.comercial_ve_oportunidade(oportunidade_id));
create policy comercial_prop_upd on public.comercial_propostas for update to authenticated using (public.comercial_pode_editar(empresa_id) and public.comercial_ve_oportunidade(oportunidade_id))
  with check (public.comercial_pode_editar(empresa_id) and public.comercial_ve_oportunidade(oportunidade_id));
create policy comercial_prop_del on public.comercial_propostas for delete to authenticated using (public.comercial_pode_editar(empresa_id) and public.comercial_ve_oportunidade(oportunidade_id) and status = 'rascunho');
drop policy if exists comercial_pi_sel on public.comercial_proposta_itens;
drop policy if exists comercial_pi_all on public.comercial_proposta_itens;
create policy comercial_pi_sel on public.comercial_proposta_itens for select to authenticated
  using (exists(select 1 from comercial_propostas p where p.id = proposta_id and public.comercial_ve_oportunidade(p.oportunidade_id)));
create policy comercial_pi_all on public.comercial_proposta_itens for all to authenticated
  using (public.comercial_pode_editar(empresa_id) and exists(select 1 from comercial_propostas p where p.id = proposta_id and p.status = 'rascunho' and public.comercial_ve_oportunidade(p.oportunidade_id)))
  with check (public.comercial_pode_editar(empresa_id) and exists(select 1 from comercial_propostas p where p.id = proposta_id and p.status = 'rascunho' and public.comercial_ve_oportunidade(p.oportunidade_id)));

grant select, insert, update, delete on public.comercial_vendedores, public.comercial_metas, public.comercial_interacoes, public.comercial_propostas, public.comercial_proposta_itens to authenticated;
grant select, insert, update on public.comercial_oportunidades to authenticated;

-- ---------- custos ficam fora do alcance do representante ----------
-- de-para com último custo, estrutura e espelho do estoque (com custo): só internos e Compras (produtos continua visível a todos)
drop policy if exists produto_fornecedores_sel on public.produto_fornecedores;
create policy produto_fornecedores_sel on public.produto_fornecedores for select to authenticated using (public.is_membro(empresa_id) or public.pode_comprar(empresa_id));
drop policy if exists produto_estrutura_sel on public.produto_estrutura;
create policy produto_estrutura_sel on public.produto_estrutura for select to authenticated using (public.is_membro(empresa_id) or public.pode_comprar(empresa_id));
drop policy if exists estoque_espelhos_sel on public.estoque_espelhos;
create policy estoque_espelhos_sel on public.estoque_espelhos for select to authenticated using (public.is_membro(empresa_id) or public.pode_comprar(empresa_id));
drop policy if exists estoque_espelho_itens_sel on public.estoque_espelho_itens;
create policy estoque_espelho_itens_sel on public.estoque_espelho_itens for select to authenticated using (public.is_membro(empresa_id) or public.pode_comprar(empresa_id));
-- Compras (requisições, cotações, pedidos) também não é assunto do representante
do $$
declare t text;
begin
  foreach t in array array['compras_requisicoes', 'compras_requisicao_itens', 'compras_cotacoes', 'compras_cotacao_itens', 'compras_pedidos', 'compras_pedido_itens',
                           'compras_recebimentos', 'compras_recebimento_itens', 'compras_pedido_lancamentos', 'compras_parametros'] loop
    execute format('drop policy if exists %I on public.%I', t || '_sel', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_membro(empresa_id) or public.pode_comprar(empresa_id))', t || '_sel', t);
  end loop;
end $$;

-- ---------- auditoria (migração 038) ----------
do $$
declare t text;
begin
  foreach t in array array['comercial_vendedores', 'comercial_metas', 'comercial_interacoes', 'comercial_oportunidades', 'comercial_propostas', 'comercial_proposta_itens'] loop
    execute format('drop trigger if exists zz_auditoria on public.%I', t);
    execute format('create trigger zz_auditoria after insert or update or delete on public.%I for each row execute function public._auditar()', t);
  end loop;
end $$;

-- ===== 20261016000043_portal_cliente.sql =====
-- =====================================================================
-- Etapa 4b — Portal do Cliente (portal.html). Regras (como no ERP Consultoria, migrações 043–045):
--  * o usuário do portal NUNCA entra em membros: identidade separada (portal_usuarios). Assim nenhuma política
--    da plataforma (is_membro, is_participante, pode_editar…) vale para ele;
--  * o cliente só lê por funções SECURITY DEFINER que devolvem colunas seguras (nada de fundo, borderô, plano,
--    centro de custo, conta ou descrição interna);
--  * prorrogação é SOLICITAÇÃO: o cliente nunca altera o vencimento; só o Financeiro aprova, e só a aprovação
--    muda a data do lançamento;
--  * título negociado com banco/fundo aparece como "pague pelo boleto do banco", sem citar o fundo.
-- Migração ADITIVA: só tabelas e funções novas.
-- =====================================================================

-- ---------- quem é cliente no portal ----------
create table if not exists public.portal_usuarios (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  favorecido_id uuid not null references public.favorecidos(id) on delete cascade,
  email text not null,
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  ultimo_acesso timestamptz,
  unique (user_id, favorecido_id)
);
create index if not exists portal_usuarios_fav on public.portal_usuarios(favorecido_id);

create table if not exists public.portal_convites (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  favorecido_id uuid not null references public.favorecidos(id) on delete cascade,
  email text not null,
  token text not null unique default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  criado_por uuid default auth.uid(),
  criado_em timestamptz not null default now(),
  expira_em timestamptz not null default now() + interval '14 days',
  aceito_em timestamptz,
  aceito_por uuid references auth.users(id),
  cancelado_em timestamptz
);
create index if not exists portal_convites_email on public.portal_convites(lower(email)) where aceito_em is null and cancelado_em is null;

-- ---------- solicitações de prorrogação ----------
create table if not exists public.portal_prorrogacoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  favorecido_id uuid not null references public.favorecidos(id) on delete cascade,
  lancamento_id uuid not null references public.lancamentos(id) on delete cascade,
  vencimento_atual date not null,
  nova_data date not null,
  valor numeric(16,2) not null,
  documento text,
  motivo text not null,
  status text not null default 'pendente' check (status in ('pendente', 'aprovada', 'recusada', 'cancelada')),
  resposta text,
  solicitado_por uuid not null default auth.uid(),
  solicitado_em timestamptz not null default now(),
  decidido_por uuid references auth.users(id),
  decidido_em timestamptz,
  check (nova_data > vencimento_atual)
);
create unique index if not exists portal_prorrog_pendente on public.portal_prorrogacoes(lancamento_id) where status = 'pendente';
create index if not exists portal_prorrog_emp on public.portal_prorrogacoes(empresa_id, status);

-- ---------- acesso interno às tabelas do portal ----------
alter table public.portal_usuarios enable row level security;
alter table public.portal_convites enable row level security;
alter table public.portal_prorrogacoes enable row level security;
drop policy if exists portal_usuarios_sel on public.portal_usuarios;
drop policy if exists portal_usuarios_upd on public.portal_usuarios;
create policy portal_usuarios_sel on public.portal_usuarios for select to authenticated using (public.is_membro(empresa_id) or user_id = (select auth.uid()));
create policy portal_usuarios_upd on public.portal_usuarios for update to authenticated using (public.pode_editar(empresa_id) or public.pode_aprovar_compra(empresa_id))
  with check (public.pode_editar(empresa_id) or public.pode_aprovar_compra(empresa_id));
drop policy if exists portal_convites_sel on public.portal_convites;
create policy portal_convites_sel on public.portal_convites for select to authenticated using (public.is_membro(empresa_id));
drop policy if exists portal_prorrog_sel on public.portal_prorrogacoes;
create policy portal_prorrog_sel on public.portal_prorrogacoes for select to authenticated using (public.is_membro(empresa_id));
grant select, update on public.portal_usuarios to authenticated;
grant select on public.portal_convites, public.portal_prorrogacoes to authenticated;

-- ---------- lado interno: convidar, cancelar, decidir ----------
create or replace function public.portal_pode_gerir(p_empresa uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select pode_editar(p_empresa) or pode_aprovar_compra(p_empresa);    -- admin, financeiro, diretor
$$;

create or replace function public.portal_criar_convite(p_empresa uuid, p_favorecido uuid, p_email text)
returns text language plpgsql security definer set search_path = public as $$
declare v_email text := lower(trim(p_email)); v_token text;
begin
  if not portal_pode_gerir(p_empresa) then raise exception 'Só admin, financeiro ou diretor convida clientes para o portal.'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'E-mail inválido: %', p_email; end if;
  if not exists (select 1 from favorecidos where id = p_favorecido and empresa_id = p_empresa and tipo in ('CLIENTES', 'TERCEIROS - CLIENTES')) then
    raise exception 'O portal é só para clientes cadastrados.'; end if;
  if exists (select 1 from membros m join auth.users u on u.id = m.user_id where lower(u.email) = v_email) then
    raise exception 'Este e-mail é de um usuário interno da plataforma. Use outro e-mail para o acesso de cliente.'; end if;
  update portal_convites set cancelado_em = now() where favorecido_id = p_favorecido and lower(email) = v_email and aceito_em is null and cancelado_em is null;
  insert into portal_convites (empresa_id, favorecido_id, email) values (p_empresa, p_favorecido, v_email) returning token into v_token;
  return v_token;
end $$;

create or replace function public.portal_cancelar_convite(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare e uuid;
begin
  select empresa_id into e from portal_convites where id = p_id;
  if e is null or not portal_pode_gerir(e) then raise exception 'Sem permissão.'; end if;
  update portal_convites set cancelado_em = now() where id = p_id and aceito_em is null;
end $$;

create or replace function public.portal_decidir_prorrogacao(p_id uuid, p_aprovar boolean, p_resposta text)
returns void language plpgsql security definer set search_path = public as $$
declare s portal_prorrogacoes; l lancamentos;
begin
  select * into s from portal_prorrogacoes where id = p_id for update;
  if s.id is null or not pode_editar(s.empresa_id) then raise exception 'Só admin ou financeiro decide prorrogação.'; end if;
  if s.status <> 'pendente' then raise exception 'Solicitação já decidida.'; end if;
  if not p_aprovar and coalesce(trim(p_resposta), '') = '' then raise exception 'Informe o motivo da recusa (o cliente vê a resposta).'; end if;
  if p_aprovar then
    select * into l from lancamentos where id = s.lancamento_id for update;
    if l.status <> 'Em aberto' then raise exception 'O título não está mais em aberto.'; end if;
    if l.fidc_proposta_id is not null then raise exception 'Título negociado com banco/fundo: a prorrogação é com a instituição.'; end if;
    update lancamentos set data = s.nova_data where id = l.id;      -- passa pelos gatilhos normais (trava, auditoria)
  end if;
  update portal_prorrogacoes set status = case when p_aprovar then 'aprovada' else 'recusada' end, resposta = nullif(trim(p_resposta), ''),
         decidido_por = auth.uid(), decidido_em = now() where id = p_id;
end $$;

-- ---------- lado do cliente ----------
-- convite visível antes do login (só o necessário para a tela de cadastro)
create or replace function public.portal_ver_convite(p_token text)
returns table(empresa text, cliente text, email text)
language sql stable security definer set search_path = public as $$
  select e.nome, f.nome, c.email from portal_convites c join empresas e on e.id = c.empresa_id join favorecidos f on f.id = c.favorecido_id
  where c.token = p_token and c.aceito_em is null and c.cancelado_em is null and c.expira_em > now();
$$;

-- aceita os convites do e-mail confirmado de quem entrou
create or replace function public.portal_aceitar_convites()
returns int language plpgsql security definer set search_path = public as $$
declare v_email text; v_conf timestamptz; r record; n int := 0;
begin
  if auth.uid() is null then return 0; end if;
  select lower(email), email_confirmed_at into v_email, v_conf from auth.users where id = auth.uid();
  if v_email is null or v_conf is null then return 0; end if;
  if exists (select 1 from membros where user_id = auth.uid()) then return 0; end if;     -- usuário interno não vira cliente
  for r in select * from portal_convites where lower(email) = v_email and aceito_em is null and cancelado_em is null and expira_em > now() loop
    insert into portal_usuarios (empresa_id, user_id, favorecido_id, email) values (r.empresa_id, auth.uid(), r.favorecido_id, v_email)
      on conflict (user_id, favorecido_id) do update set ativo = true;
    update portal_convites set aceito_em = now(), aceito_por = auth.uid() where id = r.id;
    n := n + 1;
  end loop;
  return n;
end $$;

-- o cliente do portal pode ver este favorecido?
create or replace function public.portal_meu(p_fav uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from portal_usuarios where user_id = auth.uid() and favorecido_id = p_fav and ativo);
$$;

create or replace function public.portal_meus_clientes()
returns table(empresa_id uuid, empresa text, favorecido_id uuid, cliente text, documento text)
language plpgsql security definer set search_path = public as $$
begin
  update portal_usuarios set ultimo_acesso = now() where user_id = auth.uid();
  return query select pu.empresa_id, e.nome, f.id, f.nome, f.documento
    from portal_usuarios pu join empresas e on e.id = pu.empresa_id join favorecidos f on f.id = pu.favorecido_id
    where pu.user_id = auth.uid() and pu.ativo order by e.nome, f.nome;
end $$;

-- títulos: a pagar à empresa (em aberto), negociados com banco/fundo e pagos nos últimos 12 meses
create or replace function public.portal_titulos(p_fav uuid)
returns table(id uuid, situacao text, data date, valor numeric, documento text, emissao date, pode_prorrogar boolean, prorrogacao text)
language sql stable security definer set search_path = public as $$
  select l.id,
         case when l.fidc_proposta_id is not null then 'negociado' when l.status = 'Em aberto' then 'aberto' else 'pago' end,
         l.data, l.valor, l.documento, l.emissao,
         (l.status = 'Em aberto' and l.fidc_proposta_id is null and not exists (select 1 from portal_prorrogacoes s where s.lancamento_id = l.id and s.status = 'pendente')),
         (select s.status || coalesce(': ' || s.resposta, '') from portal_prorrogacoes s where s.lancamento_id = l.id order by s.solicitado_em desc limit 1)
  from lancamentos l join plano_contas p on p.id = l.plano_id
  where portal_meu(p_fav) and l.favorecido_id = p_fav and p.tipo = 'E' and p.natureza = 'C'
    and ((l.status = 'Em aberto') or (l.fidc_proposta_id is not null and l.data >= current_date - 30) or (l.status = 'Pago' and l.data >= current_date - 365))
  order by l.data;
$$;

-- notas fiscais de venda para o cliente (pelo cadastro ou pelo CNPJ)
create or replace function public.portal_notas(p_fav uuid, p_de date)
returns table(id uuid, numero int, serie text, emissao date, valor numeric, chave text, tem_xml boolean, parcelas jsonb)
language sql stable security definer set search_path = public as $$
  select n.id, n.numero, n.serie, n.emissao, n.v_nf, n.chave, n.xml is not null,
         coalesce((select jsonb_agg(jsonb_build_object('numero', pa.numero, 'vencimento', pa.vencimento, 'valor', pa.valor) order by pa.numero) from nfe_parcelas pa where pa.nota_id = n.id), '[]'::jsonb)
  from nfe_notas n, favorecidos f
  where portal_meu(p_fav) and f.id = p_fav and n.empresa_id = f.empresa_id and n.tipo = 'saida' and n.emissao_propria and n.situacao = 'autorizada'
    and n.emissao >= p_de and (n.favorecido_id = f.id or (regexp_replace(coalesce(f.documento, ''), '\D', '', 'g') <> '' and n.dest_doc = regexp_replace(f.documento, '\D', '', 'g')))
  order by n.emissao desc, n.numero desc;
$$;

create or replace function public.portal_nota_xml(p_fav uuid, p_nota uuid)
returns text language sql stable security definer set search_path = public as $$
  select n.xml from nfe_notas n, favorecidos f
  where portal_meu(p_fav) and f.id = p_fav and n.id = p_nota and n.empresa_id = f.empresa_id and n.tipo = 'saida' and n.emissao_propria
    and (n.favorecido_id = f.id or (regexp_replace(coalesce(f.documento, ''), '\D', '', 'g') <> '' and n.dest_doc = regexp_replace(f.documento, '\D', '', 'g')));
$$;

-- o que o cliente comprou (por produto, 12 meses)
create or replace function public.portal_compras(p_fav uuid)
returns table(codigo text, descricao text, unidade text, quantidade numeric, valor numeric, ultima date, notas bigint)
language sql stable security definer set search_path = public as $$
  select i.cprod, max(i.xprod), max(i.ucom), sum(i.qcom), sum(i.vprod), max(n.emissao), count(distinct n.id)
  from portal_notas(p_fav, current_date - 365) pn join nfe_notas n on n.id = pn.id join nfe_itens i on i.nota_id = n.id
  group by i.cprod order by sum(i.vprod) desc;
$$;

create or replace function public.portal_solicitar_prorrogacao(p_fav uuid, p_lancamento uuid, p_nova_data date, p_motivo text)
returns uuid language plpgsql security definer set search_path = public as $$
declare l lancamentos; v uuid;
begin
  if not portal_meu(p_fav) then raise exception 'Sem acesso.'; end if;
  select * into l from lancamentos where id = p_lancamento and favorecido_id = p_fav;
  if l.id is null or l.status <> 'Em aberto' then raise exception 'Título não encontrado ou não está em aberto.'; end if;
  if l.fidc_proposta_id is not null then raise exception 'Este título foi negociado com uma instituição financeira: trate a prorrogação com o banco indicado no boleto.'; end if;
  if p_nova_data is null or p_nova_data <= l.data then raise exception 'A nova data precisa ser depois do vencimento atual.'; end if;
  if p_nova_data > l.data + 90 then raise exception 'Pedidos acima de 90 dias devem ser tratados diretamente com o financeiro.'; end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Informe o motivo.'; end if;
  if exists (select 1 from portal_prorrogacoes where lancamento_id = l.id and status = 'pendente') then raise exception 'Já existe um pedido de prorrogação em análise para este título.'; end if;
  insert into portal_prorrogacoes (empresa_id, favorecido_id, lancamento_id, vencimento_atual, nova_data, valor, documento, motivo)
  values (l.empresa_id, p_fav, l.id, l.data, p_nova_data, l.valor, l.documento, trim(p_motivo)) returning id into v;
  return v;
end $$;

create or replace function public.portal_minhas_solicitacoes(p_fav uuid)
returns table(id uuid, documento text, valor numeric, vencimento_atual date, nova_data date, status text, resposta text, solicitado_em timestamptz)
language sql stable security definer set search_path = public as $$
  select s.id, s.documento, s.valor, s.vencimento_atual, s.nova_data, s.status, s.resposta, s.solicitado_em
  from portal_prorrogacoes s where portal_meu(p_fav) and s.favorecido_id = p_fav order by s.solicitado_em desc limit 50;
$$;

revoke all on function public.portal_criar_convite(uuid, uuid, text), public.portal_cancelar_convite(uuid), public.portal_decidir_prorrogacao(uuid, boolean, text),
  public.portal_aceitar_convites(), public.portal_meus_clientes(), public.portal_titulos(uuid), public.portal_notas(uuid, date), public.portal_nota_xml(uuid, uuid),
  public.portal_compras(uuid), public.portal_solicitar_prorrogacao(uuid, uuid, date, text), public.portal_minhas_solicitacoes(uuid) from public, anon;
grant execute on function public.portal_criar_convite(uuid, uuid, text), public.portal_cancelar_convite(uuid), public.portal_decidir_prorrogacao(uuid, boolean, text),
  public.portal_aceitar_convites(), public.portal_meus_clientes(), public.portal_titulos(uuid), public.portal_notas(uuid, date), public.portal_nota_xml(uuid, uuid),
  public.portal_compras(uuid), public.portal_solicitar_prorrogacao(uuid, uuid, date, text), public.portal_minhas_solicitacoes(uuid),
  public.portal_meu(uuid), public.portal_pode_gerir(uuid) to authenticated;
grant execute on function public.portal_ver_convite(text) to anon, authenticated;

-- ---------- auditoria ----------
do $$
declare t text;
begin
  foreach t in array array['portal_usuarios', 'portal_convites', 'portal_prorrogacoes'] loop
    execute format('drop trigger if exists zz_auditoria on public.%I', t);
    execute format('create trigger zz_auditoria after insert or update or delete on public.%I for each row execute function public._auditar()', t);
  end loop;
end $$;

-- ===== 20261017000044_producao.sql =====
-- =====================================================================
-- Etapa 5 — PCP e Produção (embalagens flexíveis: extrusão → impressão → corte/solda, rebobinamento, recuperação).
-- Decisão de 17/10/2026: a plataforma faz tudo (OP, programação, apontamento, bobinas/etiquetas, rastreabilidade,
-- indicadores), mas enquanto o trabalho continua no Iniflex os dados entram por IMPORTAÇÃO; quando a plataforma virar
-- o sistema principal, os mesmos registros passam a ser lançados aqui (coluna origem = 'iniflex' | 'plataforma').
-- Apontamento em terminal por setor, cada operador com o próprio acesso: perfil novo "producao".
-- Migração ADITIVA, com uma alteração em função existente: is_membro passa a excluir também "producao"
-- (o operador não deve ler financeiro, lançamentos, saldos).
-- =====================================================================

alter type public.papel_membro add value if not exists 'producao';

create or replace function public.is_membro(p_empresa uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from membros where empresa_id = p_empresa and user_id = auth.uid() and papel::text not in ('compras', 'vendas', 'producao'));
$$;

-- planeja e mantém cadastros de produção: admin, financeiro, diretor
create or replace function public.pode_pcp(p_empresa uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from membros where empresa_id = p_empresa and user_id = auth.uid() and papel::text in ('admin', 'financeiro', 'diretor'));
$$;
-- aponta produção: os de cima e o operador
create or replace function public.pode_apontar(p_empresa uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from membros where empresa_id = p_empresa and user_id = auth.uid() and papel::text in ('admin', 'financeiro', 'diretor', 'producao'));
$$;
-- lê produção: membros internos e operadores
create or replace function public.ve_producao(p_empresa uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from membros where empresa_id = p_empresa and user_id = auth.uid() and papel::text in ('admin', 'financeiro', 'diretor', 'leitura', 'producao'));
$$;

-- ---------- cadastros ----------
create table if not exists public.prod_setores (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  nome text not null,
  ordem smallint not null default 0,          -- posição no fluxo (extrusão 1, impressão 2, corte e solda 3…)
  horas_dia numeric(5,2) not null default 24, -- horas produtivas por dia (capacidade e OEE)
  ativo boolean not null default true,
  unique (empresa_id, nome)
);
create table if not exists public.prod_maquinas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  setor_id uuid not null references public.prod_setores(id),
  codigo text not null,
  nome text not null,
  capacidade_kg_h numeric(10,2),              -- velocidade nominal (performance do OEE)
  ativo boolean not null default true,
  observacao text,
  unique (empresa_id, codigo)
);
create table if not exists public.prod_motivos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  tipo text not null check (tipo in ('parada', 'refugo')),
  nome text not null,
  planejada boolean not null default false,   -- parada planejada (setup, limpeza programada) não derruba a disponibilidade
  ativo boolean not null default true,
  unique (empresa_id, tipo, nome)
);
create table if not exists public.prod_operadores (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  nome text not null,
  user_id uuid references auth.users(id) on delete set null,
  setores uuid[] not null default '{}',
  matricula text,
  ativo boolean not null default true,
  unique (empresa_id, user_id)
);
-- roteiro do produto: etapas na ordem, com máquina padrão
create table if not exists public.prod_roteiros (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  produto_id uuid not null references public.produtos(id) on delete cascade,
  seq smallint not null,
  setor_id uuid not null references public.prod_setores(id),
  maquina_id uuid references public.prod_maquinas(id) on delete set null,
  velocidade_kg_h numeric(10,2),
  setup_min numeric(8,2),
  observacao text,
  unique (produto_id, seq)
);
-- clichês, cilindros e facas
create table if not exists public.prod_ferramentas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  tipo text not null check (tipo in ('cliche', 'cilindro', 'faca', 'outro')),
  codigo text not null,
  descricao text,
  produto_id uuid references public.produtos(id) on delete set null,
  favorecido_id uuid references public.favorecidos(id) on delete set null,   -- cliente dono da arte
  cores smallint,
  vida_util_m numeric(14,2),
  metros_usados numeric(14,2) not null default 0,
  localizacao text,
  situacao text not null default 'ativa' check (situacao in ('ativa', 'manutencao', 'descartada')),
  observacao text,
  unique (empresa_id, codigo)
);

-- ---------- ordens de produção ----------
create table if not exists public.prod_ordens (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  numero int not null default 0,
  numero_iniflex text,                         -- nº da OP no Iniflex (importação)
  origem text not null default 'plataforma' check (origem in ('plataforma', 'iniflex')),
  produto_id uuid references public.produtos(id) on delete set null,
  codigo_produto text, descricao text,         -- como veio (mesmo sem cadastro)
  quantidade numeric(16,3) not null check (quantidade > 0),
  unidade text not null default 'KG',
  favorecido_id uuid references public.favorecidos(id) on delete set null,
  cliente text,
  pedido_iniflex text,
  emissao date not null default current_date,
  entrega date,
  prioridade smallint not null default 3 check (prioridade between 1 and 5),   -- 1 = mais urgente
  status text not null default 'planejada' check (status in ('planejada', 'liberada', 'em_producao', 'concluida', 'cancelada')),
  observacao text,
  criado_por uuid default auth.uid(),
  criado_em timestamptz not null default now(),
  concluida_em timestamptz,
  unique (empresa_id, numero)
);
create unique index if not exists prod_ordens_iniflex on public.prod_ordens(empresa_id, numero_iniflex) where numero_iniflex is not null;
create index if not exists prod_ordens_status on public.prod_ordens(empresa_id, status);

create table if not exists public.prod_ordem_etapas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  ordem_id uuid not null references public.prod_ordens(id) on delete cascade,
  seq smallint not null,
  setor_id uuid not null references public.prod_setores(id),
  maquina_id uuid references public.prod_maquinas(id) on delete set null,
  qtd_prevista numeric(16,3),
  inicio_previsto date, fim_previsto date,
  horas_previstas numeric(8,2),
  status text not null default 'aguardando' check (status in ('aguardando', 'em_andamento', 'concluida')),
  qtd_boa numeric(16,3) not null default 0,
  refugo numeric(16,3) not null default 0,
  unique (ordem_id, seq)
);
create index if not exists prod_etapas_maquina on public.prod_ordem_etapas(maquina_id, inicio_previsto);

-- ---------- chão de fábrica ----------
create table if not exists public.prod_apontamentos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  ordem_id uuid not null references public.prod_ordens(id) on delete cascade,
  etapa_id uuid references public.prod_ordem_etapas(id) on delete set null,
  setor_id uuid references public.prod_setores(id),
  maquina_id uuid references public.prod_maquinas(id),
  operador_id uuid references public.prod_operadores(id) on delete set null,
  operador_nome text,
  turno text,
  inicio timestamptz not null default now(),
  fim timestamptz,
  qtd_boa numeric(16,3) not null default 0,     -- na unidade da OP (normalmente kg)
  refugo numeric(16,3) not null default 0,      -- apara/refugo em kg
  refugo_motivo_id uuid references public.prod_motivos(id) on delete set null,
  observacao text,
  origem text not null default 'plataforma' check (origem in ('plataforma', 'iniflex')),
  chave_importacao text,                        -- evita importar a mesma linha duas vezes
  criado_por uuid default auth.uid(),
  criado_em timestamptz not null default now(),
  check (fim is null or fim >= inicio)
);
create unique index if not exists prod_apont_chave on public.prod_apontamentos(empresa_id, chave_importacao) where chave_importacao is not null;
create index if not exists prod_apont_ordem on public.prod_apontamentos(ordem_id);
create index if not exists prod_apont_maq on public.prod_apontamentos(maquina_id, inicio);

create table if not exists public.prod_paradas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  maquina_id uuid not null references public.prod_maquinas(id),
  ordem_id uuid references public.prod_ordens(id) on delete set null,
  motivo_id uuid references public.prod_motivos(id) on delete set null,
  inicio timestamptz not null default now(),
  fim timestamptz,
  operador_id uuid references public.prod_operadores(id) on delete set null,
  observacao text,
  origem text not null default 'plataforma' check (origem in ('plataforma', 'iniflex')),
  criado_por uuid default auth.uid(),
  check (fim is null or fim >= inicio)
);
create index if not exists prod_paradas_maq on public.prod_paradas(maquina_id, inicio);

-- bobinas (ou volumes) produzidas: cada uma tem etiqueta com código; a "mãe" liga a bobina impressa à extrudada
create table if not exists public.prod_bobinas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  codigo text not null,
  ordem_id uuid not null references public.prod_ordens(id) on delete cascade,
  etapa_id uuid references public.prod_ordem_etapas(id) on delete set null,
  apontamento_id uuid references public.prod_apontamentos(id) on delete set null,
  maquina_id uuid references public.prod_maquinas(id),
  peso_kg numeric(12,3) not null check (peso_kg > 0),
  metros numeric(14,2),
  quantidade numeric(16,3),                     -- unidades/milheiros quando for saco/sacola
  mae_id uuid references public.prod_bobinas(id) on delete set null,
  lote_materia text,                            -- lote/NF da resina usada (extrusão)
  situacao text not null default 'estoque' check (situacao in ('estoque', 'consumida', 'expedida', 'refugada')),
  operador_id uuid references public.prod_operadores(id) on delete set null,
  criado_em timestamptz not null default now(),
  unique (empresa_id, codigo)
);
create index if not exists prod_bobinas_ordem on public.prod_bobinas(ordem_id);
create index if not exists prod_bobinas_mae on public.prod_bobinas(mae_id);

-- consumo real de matéria-prima por OP (para custo real × teórico e rastreabilidade do lote)
create table if not exists public.prod_consumos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  ordem_id uuid not null references public.prod_ordens(id) on delete cascade,
  apontamento_id uuid references public.prod_apontamentos(id) on delete set null,
  produto_id uuid references public.produtos(id) on delete set null,
  codigo text,
  quantidade numeric(16,4) not null check (quantidade > 0),
  lote text,                                    -- lote do fornecedor / nº da NF de entrada
  origem text not null default 'plataforma' check (origem in ('plataforma', 'iniflex')),
  criado_por uuid default auth.uid(),
  criado_em timestamptz not null default now()
);
create index if not exists prod_consumos_ordem on public.prod_consumos(ordem_id);

-- ---------- gatilhos ----------
drop trigger if exists prod_ordens_numero on public.prod_ordens;
create trigger prod_ordens_numero before insert on public.prod_ordens for each row execute function public._compras_numero();

-- apontamento: soma na etapa e põe a OP em produção
create or replace function public._prod_apont_soma() returns trigger language plpgsql security definer set search_path = public as $$
declare eid uuid := coalesce(new.etapa_id, old.etapa_id); oid uuid := coalesce(new.ordem_id, old.ordem_id);
begin
  if eid is not null then
    update prod_ordem_etapas e set qtd_boa = coalesce((select sum(qtd_boa) from prod_apontamentos where etapa_id = eid), 0),
           refugo = coalesce((select sum(refugo) from prod_apontamentos where etapa_id = eid), 0),
           status = case when e.status = 'concluida' then 'concluida'
                         when exists(select 1 from prod_apontamentos where etapa_id = eid) then 'em_andamento' else 'aguardando' end
     where e.id = eid;
  end if;
  update prod_ordens set status = 'em_producao' where id = oid and status in ('planejada', 'liberada') and tg_op <> 'DELETE';
  return null;
end $$;
drop trigger if exists prod_apont_soma on public.prod_apontamentos;
create trigger prod_apont_soma after insert or update or delete on public.prod_apontamentos for each row execute function public._prod_apont_soma();

create or replace function public._prod_ordem_regras() returns trigger language plpgsql as $$
begin
  if new.status = 'concluida' and (tg_op = 'INSERT' or old.status <> 'concluida') then new.concluida_em := now(); end if;
  if new.status <> 'concluida' then new.concluida_em := null; end if;
  return new;
end $$;
drop trigger if exists prod_ordem_regras on public.prod_ordens;
create trigger prod_ordem_regras before insert or update on public.prod_ordens for each row execute function public._prod_ordem_regras();

-- bobina com mãe: a mãe passa a "consumida"
create or replace function public._prod_bobina_mae() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.mae_id is not null then update prod_bobinas set situacao = 'consumida' where id = new.mae_id and situacao = 'estoque'; end if;
  return null;
end $$;
drop trigger if exists prod_bobina_mae on public.prod_bobinas;
create trigger prod_bobina_mae after insert on public.prod_bobinas for each row execute function public._prod_bobina_mae();

-- operador ligado ao usuário que está no terminal
create or replace function public.meu_operador(p_empresa uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select id from prod_operadores where empresa_id = p_empresa and user_id = auth.uid() and ativo limit 1;
$$;

-- importação do Iniflex: OPs (upsert pelo nº do Iniflex; liga o produto pelo código; cria as etapas pelo roteiro na 1ª vez)
-- p_itens: [{numero_iniflex, codigo_produto, descricao, quantidade, unidade, cliente, cliente_doc, pedido, emissao, entrega, status}]
create or replace function public.prod_importar_ordens(p_empresa uuid, p_itens jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare x record; oid uuid; novo boolean; n_novo int := 0; n_at int := 0; pr uuid; fav uuid;
begin
  if not pode_pcp(p_empresa) then raise exception 'Só admin, financeiro ou diretor importa ordens.'; end if;
  for x in select * from jsonb_to_recordset(p_itens) as t(numero_iniflex text, codigo_produto text, descricao text, quantidade numeric, unidade text,
                                                          cliente text, cliente_doc text, pedido text, emissao date, entrega date, status text) loop
    if coalesce(trim(x.numero_iniflex), '') = '' or coalesce(x.quantidade, 0) <= 0 then continue; end if;
    select id into pr from produtos where empresa_id = p_empresa and codigo = trim(x.codigo_produto);
    select id into fav from favorecidos where empresa_id = p_empresa and tipo in ('CLIENTES', 'TERCEIROS - CLIENTES')
       and regexp_replace(coalesce(documento, ''), '\D', '', 'g') = regexp_replace(coalesce(x.cliente_doc, ''), '\D', '', 'g') and coalesce(x.cliente_doc, '') <> '' limit 1;
    select id into oid from prod_ordens where empresa_id = p_empresa and numero_iniflex = trim(x.numero_iniflex);
    novo := oid is null;
    if novo then
      insert into prod_ordens (empresa_id, numero_iniflex, origem, produto_id, codigo_produto, descricao, quantidade, unidade, favorecido_id, cliente, pedido_iniflex, emissao, entrega, status)
      values (p_empresa, trim(x.numero_iniflex), 'iniflex', pr, x.codigo_produto, x.descricao, x.quantidade, coalesce(nullif(upper(trim(x.unidade)), ''), 'KG'), fav, x.cliente, x.pedido,
              coalesce(x.emissao, current_date), x.entrega, coalesce(nullif(x.status, ''), 'liberada'))
      returning id into oid;
      insert into prod_ordem_etapas (empresa_id, ordem_id, seq, setor_id, maquina_id, qtd_prevista)
      select p_empresa, oid, r.seq, r.setor_id, r.maquina_id, x.quantidade from prod_roteiros r where r.produto_id = pr order by r.seq;
      n_novo := n_novo + 1;
    else
      update prod_ordens set quantidade = x.quantidade, entrega = coalesce(x.entrega, entrega), produto_id = coalesce(produto_id, pr), favorecido_id = coalesce(favorecido_id, fav),
             status = case when x.status in ('concluida', 'cancelada') then x.status else status end
       where id = oid;
      n_at := n_at + 1;
    end if;
  end loop;
  return jsonb_build_object('novas', n_novo, 'atualizadas', n_at);
end $$;

-- importação do Iniflex: apontamentos (ligados à OP pelo nº do Iniflex e à máquina pelo código)
-- p_itens: [{numero_iniflex, maquina, operador, inicio, fim, qtd_boa, refugo, turno, chave}]
create or replace function public.prod_importar_apontamentos(p_empresa uuid, p_itens jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare x record; o prod_ordens; mq prod_maquinas; et uuid; n int := 0; sem_op int := 0; dup int := 0;
begin
  if not pode_pcp(p_empresa) then raise exception 'Só admin, financeiro ou diretor importa apontamentos.'; end if;
  for x in select * from jsonb_to_recordset(p_itens) as t(numero_iniflex text, maquina text, operador text, inicio timestamptz, fim timestamptz,
                                                          qtd_boa numeric, refugo numeric, turno text, chave text) loop
    select * into o from prod_ordens where empresa_id = p_empresa and numero_iniflex = trim(x.numero_iniflex);
    if o.id is null then sem_op := sem_op + 1; continue; end if;
    select * into mq from prod_maquinas where empresa_id = p_empresa and (codigo = trim(x.maquina) or nome = trim(x.maquina)) limit 1;
    select id into et from prod_ordem_etapas where ordem_id = o.id and (mq.id is null or setor_id = mq.setor_id) order by seq limit 1;
    begin
      insert into prod_apontamentos (empresa_id, ordem_id, etapa_id, setor_id, maquina_id, operador_nome, turno, inicio, fim, qtd_boa, refugo, origem, chave_importacao)
      values (p_empresa, o.id, et, mq.setor_id, mq.id, x.operador, x.turno, coalesce(x.inicio, now()), x.fim, coalesce(x.qtd_boa, 0), coalesce(x.refugo, 0), 'iniflex',
              coalesce(nullif(x.chave, ''), md5(concat_ws('|', x.numero_iniflex, x.maquina, x.inicio, x.fim, x.qtd_boa, x.refugo))));
      n := n + 1;
    exception when unique_violation then dup := dup + 1;
    end;
  end loop;
  return jsonb_build_object('importados', n, 'sem_op', sem_op, 'repetidos', dup);
end $$;

revoke all on function public.prod_importar_ordens(uuid, jsonb), public.prod_importar_apontamentos(uuid, jsonb) from public, anon;
grant execute on function public.prod_importar_ordens(uuid, jsonb), public.prod_importar_apontamentos(uuid, jsonb), public.pode_pcp(uuid), public.pode_apontar(uuid),
  public.ve_producao(uuid), public.meu_operador(uuid) to authenticated;

-- ---------- planta da fábrica (tela de acompanhamento) ----------
-- tipo de desenho, posição (metros, canto da máquina) e giro de cada máquina; os demais elementos (setores, corredores,
-- áreas, portões, setas de fluxo) ficam num JSON por empresa, montado no editor da tela Planta da fábrica.
alter table public.prod_maquinas add column if not exists tipo_visual text not null default 'generica'
  check (tipo_visual in ('extrusora', 'impressora', 'corte_solda', 'rebobinadeira', 'aglutinador', 'generica'));
alter table public.prod_maquinas add column if not exists pos_x numeric(7,2);
alter table public.prod_maquinas add column if not exists pos_y numeric(7,2);
alter table public.prod_maquinas add column if not exists rotacao smallint not null default 0 check (rotacao in (0, 90));
create table if not exists public.prod_planta (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null unique references public.empresas(id) on delete cascade,
  largura_m numeric(7,2) not null default 60 check (largura_m between 5 and 500),
  profundidade_m numeric(7,2) not null default 30 check (profundidade_m between 5 and 500),
  elementos jsonb not null default '[]'::jsonb,
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid default auth.uid()
);

-- ---------- acesso ----------
do $$
declare t text;
begin
  -- cadastros e OPs: leitura de quem vê produção; escrita do PCP
  foreach t in array array['prod_setores', 'prod_maquinas', 'prod_motivos', 'prod_operadores', 'prod_roteiros', 'prod_ferramentas', 'prod_ordens', 'prod_ordem_etapas', 'prod_planta'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_sel', t);
    execute format('drop policy if exists %I on public.%I', t || '_all', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.ve_producao(empresa_id))', t || '_sel', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.pode_pcp(empresa_id)) with check (public.pode_pcp(empresa_id))', t || '_all', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
  -- chão de fábrica: lê quem vê produção; aponta quem pode apontar; operador só altera/exclui o que ele mesmo lançou
  foreach t in array array['prod_apontamentos', 'prod_paradas', 'prod_bobinas', 'prod_consumos'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_sel', t);
    execute format('drop policy if exists %I on public.%I', t || '_ins', t);
    execute format('drop policy if exists %I on public.%I', t || '_upd', t);
    execute format('drop policy if exists %I on public.%I', t || '_del', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.ve_producao(empresa_id))', t || '_sel', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.pode_apontar(empresa_id))', t || '_ins', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
  execute 'create policy prod_apontamentos_upd on public.prod_apontamentos for update to authenticated using (public.pode_pcp(empresa_id) or (public.pode_apontar(empresa_id) and criado_por = (select auth.uid()))) with check (public.pode_apontar(empresa_id))';
  execute 'create policy prod_apontamentos_del on public.prod_apontamentos for delete to authenticated using (public.pode_pcp(empresa_id) or (public.pode_apontar(empresa_id) and criado_por = (select auth.uid()) and criado_em > now() - interval ''1 day''))';
  execute 'create policy prod_paradas_upd on public.prod_paradas for update to authenticated using (public.pode_pcp(empresa_id) or (public.pode_apontar(empresa_id) and criado_por = (select auth.uid()))) with check (public.pode_apontar(empresa_id))';
  execute 'create policy prod_paradas_del on public.prod_paradas for delete to authenticated using (public.pode_pcp(empresa_id))';
  execute 'create policy prod_bobinas_upd on public.prod_bobinas for update to authenticated using (public.pode_apontar(empresa_id)) with check (public.pode_apontar(empresa_id))';
  execute 'create policy prod_bobinas_del on public.prod_bobinas for delete to authenticated using (public.pode_pcp(empresa_id))';
  execute 'create policy prod_consumos_upd on public.prod_consumos for update to authenticated using (public.pode_pcp(empresa_id)) with check (public.pode_pcp(empresa_id))';
  execute 'create policy prod_consumos_del on public.prod_consumos for delete to authenticated using (public.pode_pcp(empresa_id) or (public.pode_apontar(empresa_id) and criado_por = (select auth.uid())))';
end $$;

-- o operador precisa enxergar produtos (descrição na OP) — produtos já é legível por qualquer participante (migração 041)

-- ---------- auditoria ----------
do $$
declare t text;
begin
  foreach t in array array['prod_setores', 'prod_maquinas', 'prod_motivos', 'prod_operadores', 'prod_roteiros', 'prod_ferramentas', 'prod_ordens', 'prod_ordem_etapas',
                           'prod_apontamentos', 'prod_paradas', 'prod_bobinas', 'prod_consumos', 'prod_planta'] loop
    execute format('drop trigger if exists zz_auditoria on public.%I', t);
    execute format('create trigger zz_auditoria after insert or update or delete on public.%I for each row execute function public._auditar()', t);
  end loop;
end $$;

-- ===== 20261018000045_logistica.sql =====
-- =====================================================================
-- Etapa 6 (parte) — Logística: frota, parâmetros, restrições de clientes, cargas e entregas.
-- Decisão de 17/10/2026 (Renan, "pode seguir"): as cargas são montadas a partir das NF-e de saída já importadas
-- (peso bruto, volumes e endereço vêm do XML guardado em nfe_notas.xml); a importação de pedidos do Iniflex fica para depois.
-- Frota atual: 3 caminhões + 1 menor (dados a cadastrar na tela Frota e parâmetros).
-- Migração ADITIVA. Também corrige a lista de áreas válidas de membros (faltavam com, cmp, prd e entra log).
-- =====================================================================

-- áreas do menu: a restrição antiga só aceitava fin, cpd e cont (as áreas criadas depois não podiam ser marcadas)
alter table public.membros drop constraint if exists membros_areas_validas;
alter table public.membros add constraint membros_areas_validas
  check (areas is null or (cardinality(areas) > 0 and areas <@ array['fin', 'com', 'cmp', 'prd', 'log', 'cpd', 'cont']::text[]));

-- monta e altera cargas: admin, financeiro, diretor
create or replace function public.pode_logistica(p_empresa uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from membros where empresa_id = p_empresa and user_id = auth.uid() and papel::text in ('admin', 'financeiro', 'diretor'));
$$;
-- vê a logística: membros internos e quem vê a produção (a planta mostra os caminhões)
create or replace function public.ve_logistica(p_empresa uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from membros where empresa_id = p_empresa and user_id = auth.uid() and papel::text in ('admin', 'financeiro', 'diretor', 'leitura', 'producao'));
$$;

create table if not exists public.log_veiculos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  codigo text not null,                       -- apelido curto: TRK-01, VUC-01
  placa text,
  tipo text not null default 'truck' check (tipo in ('carreta', 'truck', 'toco', 'tres_quartos', 'vuc', 'utilitario', 'outro')),
  carga_kg numeric(10,1) not null check (carga_kg > 0),
  comp_m numeric(6,2), larg_m numeric(6,2), alt_m numeric(6,2),     -- medidas internas do baú
  ocupacao_max_pct numeric(5,1) not null default 95 check (ocupacao_max_pct between 10 and 110),
  pequeno boolean not null default false,     -- atende cliente que só recebe veículo pequeno / centro urbano
  max_entregas smallint,
  consumo_km_l numeric(6,2), custo_km numeric(10,2),
  motorista text,
  situacao text not null default 'disponivel' check (situacao in ('disponivel', 'manutencao', 'inativo')),
  observacao text,
  unique (empresa_id, codigo)
);

create table if not exists public.log_parametros (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null unique references public.empresas(id) on delete cascade,
  origem_cmun text,                            -- código IBGE do ponto de saída (vazio = município do emitente das notas)
  fator_rodoviario numeric(4,2) not null default 1.30,   -- distância em linha reta × fator ≈ distância por estrada
  velocidade_kmh numeric(5,1) not null default 55,
  min_por_entrega numeric(5,1) not null default 25,
  jornada_h numeric(4,1) not null default 10,
  diesel_rs_l numeric(6,3),
  m3_por_t numeric(6,2) not null default 4,    -- volume estimado por tonelada quando o produto não tem medida
  raio_max_km numeric(7,1) not null default 600, -- acima disso a entrega é sugerida para transportadora
  mod_fretes text[] not null default array['0', '9'],    -- modFrete das notas que a frota entrega (0 = por conta do emitente)
  dias_atraso smallint not null default 3      -- nota parada há mais que isso entra como atrasada
);

create table if not exists public.log_clientes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  documento text not null,                     -- CNPJ/CPF do destinatário (só dígitos)
  nome text,
  so_pequeno boolean not null default false,
  dias_receb smallint[],                       -- 0 = domingo … 6 = sábado; vazio = qualquer dia
  horario text,
  observacao text,
  unique (empresa_id, documento)
);

create table if not exists public.log_cargas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  numero int not null default 0,
  data date not null default current_date,
  veiculo_id uuid references public.log_veiculos(id) on delete set null,
  motorista text,
  status text not null default 'planejada' check (status in ('planejada', 'carregando', 'pronta', 'em_rota', 'concluida', 'cancelada')),
  peso_kg numeric(12,1), volume_m3 numeric(10,2), km_previsto numeric(9,1), horas_previstas numeric(6,2), frete_previsto numeric(12,2),
  km_real numeric(9,1),
  saida_em timestamptz, retorno_em timestamptz,
  observacao text,
  criado_por uuid default auth.uid(), criado_em timestamptz not null default now(),
  unique (empresa_id, numero)
);
create index if not exists log_cargas_data on public.log_cargas(empresa_id, data);

create table if not exists public.log_carga_notas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  carga_id uuid not null references public.log_cargas(id) on delete cascade,
  nota_id uuid not null references public.nfe_notas(id) on delete cascade,
  seq smallint not null default 0,             -- ordem de entrega (o carregamento é o inverso)
  peso_kg numeric(12,1), volume_m3 numeric(10,2),
  situacao text not null default 'pendente' check (situacao in ('pendente', 'entregue', 'nao_entregue', 'devolvida')),
  entregue_em timestamptz, observacao text,
  unique (carga_id, nota_id)
);
create index if not exists log_carga_notas_nota on public.log_carga_notas(nota_id);

-- numeração e datas da carga
drop trigger if exists log_cargas_numero on public.log_cargas;
create trigger log_cargas_numero before insert on public.log_cargas for each row execute function public._compras_numero();
create or replace function public._log_carga_regras() returns trigger language plpgsql as $$
begin
  if new.status = 'em_rota' and (tg_op = 'INSERT' or old.status <> 'em_rota') and new.saida_em is null then new.saida_em := now(); end if;
  if new.status = 'concluida' and (tg_op = 'INSERT' or old.status <> 'concluida') and new.retorno_em is null then new.retorno_em := now(); end if;
  return new;
end $$;
drop trigger if exists log_carga_regras on public.log_cargas;
create trigger log_carga_regras before insert or update on public.log_cargas for each row execute function public._log_carga_regras();

-- a mesma nota não pode estar em duas cargas ativas
create or replace function public._log_nota_unica() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists(select 1 from log_carga_notas cn join log_cargas c on c.id = cn.carga_id
             where cn.nota_id = new.nota_id and cn.id <> new.id and c.status <> 'cancelada' and cn.situacao in ('pendente', 'entregue')) then
    raise exception 'A nota já está em outra carga. Tire de lá antes.';
  end if;
  if new.situacao = 'entregue' and new.entregue_em is null then new.entregue_em := now(); end if;
  return new;
end $$;
drop trigger if exists log_nota_unica on public.log_carga_notas;
create trigger log_nota_unica before insert or update on public.log_carga_notas for each row execute function public._log_nota_unica();

-- notas de saída que ainda precisam ser entregues (peso, volumes e endereço lidos do XML)
create or replace function public.log_notas_pendentes(p_empresa uuid, p_de date, p_ate date)
returns table(id uuid, numero int, serie text, emissao date, favorecido_id uuid, dest_doc text, dest_nome text, uf text, cmun text, xmun text,
              bairro text, cep text, logradouro text, nro text, peso_b numeric, peso_l numeric, q_vol numeric, v_nf numeric, mod_frete text, emit_cmun text)
language plpgsql stable security definer set search_path = public as $$
declare mods text[];
begin
  if not pode_logistica(p_empresa) then raise exception 'Sem permissão para a logística.'; end if;
  select coalesce((select mod_fretes from log_parametros where empresa_id = p_empresa), array['0', '9']) into mods;
  return query
  with ns as (select array[array['n', 'http://www.portalfiscal.inf.br/nfe']] a),
  base as (
    select n.id, n.numero, n.serie, n.emissao, n.favorecido_id, n.dest_doc, n.dest_nome, n.dest_uf, n.v_nf, n.xml::xml x
      from nfe_notas n
     where n.empresa_id = p_empresa and n.tipo = 'saida' and n.emissao_propria and n.situacao = 'autorizada'
       and coalesce(n.finalidade, '1') = '1' and n.xml is not null and n.emissao between p_de and p_ate
       and not exists(select 1 from log_carga_notas cn join log_cargas c on c.id = cn.carga_id
                       where cn.nota_id = n.id and c.status <> 'cancelada' and cn.situacao in ('pendente', 'entregue')))
  select b.id, b.numero, b.serie, b.emissao, b.favorecido_id, b.dest_doc, b.dest_nome, b.dest_uf,
         (xpath('//n:dest/n:enderDest/n:cMun/text()', b.x, ns.a))[1]::text,
         (xpath('//n:dest/n:enderDest/n:xMun/text()', b.x, ns.a))[1]::text,
         (xpath('//n:dest/n:enderDest/n:xBairro/text()', b.x, ns.a))[1]::text,
         (xpath('//n:dest/n:enderDest/n:CEP/text()', b.x, ns.a))[1]::text,
         (xpath('//n:dest/n:enderDest/n:xLgr/text()', b.x, ns.a))[1]::text,
         (xpath('//n:dest/n:enderDest/n:nro/text()', b.x, ns.a))[1]::text,
         coalesce((select sum(nullif(v::text, '')::numeric) from unnest(xpath('//n:transp/n:vol/n:pesoB/text()', b.x, ns.a)) v), 0),
         coalesce((select sum(nullif(v::text, '')::numeric) from unnest(xpath('//n:transp/n:vol/n:pesoL/text()', b.x, ns.a)) v), 0),
         coalesce((select sum(nullif(v::text, '')::numeric) from unnest(xpath('//n:transp/n:vol/n:qVol/text()', b.x, ns.a)) v), 0),
         b.v_nf,
         (xpath('//n:transp/n:modFrete/text()', b.x, ns.a))[1]::text,
         (xpath('//n:emit/n:enderEmit/n:cMun/text()', b.x, ns.a))[1]::text
    from base b, ns
   where (xpath('//n:transp/n:modFrete/text()', b.x, ns.a))[1]::text = any(mods);
end $$;

-- resumo das notas de uma lista de cargas (para as telas, sem ler o XML de novo)
create or replace function public.log_notas_das_cargas(p_empresa uuid, p_cargas uuid[])
returns table(carga_nota_id uuid, carga_id uuid, nota_id uuid, seq smallint, situacao text, entregue_em timestamptz, numero int, emissao date, dest_doc text, dest_nome text,
              uf text, cmun text, xmun text, bairro text, cep text, logradouro text, nro text, peso_kg numeric, volume_m3 numeric, v_nf numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not ve_logistica(p_empresa) then raise exception 'Sem permissão para a logística.'; end if;
  return query
  with ns as (select array[array['n', 'http://www.portalfiscal.inf.br/nfe']] a)
  select cn.id, cn.carga_id, n.id, cn.seq, cn.situacao, cn.entregue_em, n.numero, n.emissao, n.dest_doc, n.dest_nome, n.dest_uf,
         (xpath('//n:dest/n:enderDest/n:cMun/text()', n.xml::xml, ns.a))[1]::text,
         (xpath('//n:dest/n:enderDest/n:xMun/text()', n.xml::xml, ns.a))[1]::text,
         (xpath('//n:dest/n:enderDest/n:xBairro/text()', n.xml::xml, ns.a))[1]::text,
         (xpath('//n:dest/n:enderDest/n:CEP/text()', n.xml::xml, ns.a))[1]::text,
         (xpath('//n:dest/n:enderDest/n:xLgr/text()', n.xml::xml, ns.a))[1]::text,
         (xpath('//n:dest/n:enderDest/n:nro/text()', n.xml::xml, ns.a))[1]::text,
         cn.peso_kg, cn.volume_m3, n.v_nf
    from log_carga_notas cn join nfe_notas n on n.id = cn.nota_id, ns
   where cn.empresa_id = p_empresa and cn.carga_id = any(p_cargas)
   order by cn.carga_id, cn.seq;
end $$;

revoke all on function public.log_notas_pendentes(uuid, date, date), public.log_notas_das_cargas(uuid, uuid[]) from public, anon;
grant execute on function public.log_notas_pendentes(uuid, date, date), public.log_notas_das_cargas(uuid, uuid[]), public.pode_logistica(uuid), public.ve_logistica(uuid) to authenticated;

-- ---------- acesso ----------
do $$
declare t text;
begin
  foreach t in array array['log_veiculos', 'log_parametros', 'log_clientes', 'log_cargas', 'log_carga_notas'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_sel', t);
    execute format('drop policy if exists %I on public.%I', t || '_all', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.ve_logistica(empresa_id))', t || '_sel', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.pode_logistica(empresa_id)) with check (public.pode_logistica(empresa_id))', t || '_all', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('drop trigger if exists zz_auditoria on public.%I', t);
    execute format('create trigger zz_auditoria after insert or update or delete on public.%I for each row execute function public._auditar()', t);
  end loop;
end $$;

-- ===== 20261021000047_credito_pago_maior.sql =====
-- Pagamento a maior ao fornecedor (21/10/2026).
-- 1) creditos.tipo ganha 'pago_maior': quando o pagamento ligado à nota passa do valor dela, a diferença vira
--    crédito com o fornecedor (ligado ao pagamento e à nota de origem) e abate as próximas notas.
-- 2) creditos_usos pode ser uma DEVOLUÇÃO EM DINHEIRO: o fornecedor (ou o cliente) devolve o valor e o uso fica
--    ligado ao lançamento de entrada/saída (lancamento_id) em vez de a uma nota.
-- Aditivo: não altera nem apaga dados. Pode rodar mais de uma vez.

alter table public.creditos drop constraint if exists creditos_tipo_check;
alter table public.creditos add constraint creditos_tipo_check
  check (tipo in ('adiantamento', 'devolucao', 'desconto', 'acordo', 'outro', 'pago_maior'));

alter table public.creditos_usos alter column nota_id drop not null;
alter table public.creditos_usos add column if not exists lancamento_id uuid references public.lancamentos(id) on delete cascade;
alter table public.creditos_usos drop constraint if exists creditos_usos_destino_check;
alter table public.creditos_usos add constraint creditos_usos_destino_check check (nota_id is not null or lancamento_id is not null);
create index if not exists creditos_usos_lanc on public.creditos_usos(lancamento_id) where lancamento_id is not null;


-- ===== 20261021000048_admin_aprova_bordero.sql =====
-- O admin também aprova/rejeita propostas de borderô FIDC (pedido do Renan em 21/10/2026).
-- Só muda a checagem de permissão de decidir_proposta_fidc (diretor OU admin); o resto da aprovação
-- continua em _aprovar_proposta_fidc, sem alteração. Pode rodar mais de uma vez.
create or replace function public.decidir_proposta_fidc(p_id uuid, p_aprovar boolean, p_motivo text default null)
returns text language plpgsql security definer set search_path = public as $$
declare pr fidc_propostas;
begin
  select * into pr from fidc_propostas where id = p_id for update;
  if not found then raise exception 'Proposta não encontrada'; end if;
  if not (is_diretor(pr.empresa_id) or exists (select 1 from membros where empresa_id = pr.empresa_id and user_id = auth.uid() and papel::text = 'admin')) then
    raise exception 'Somente o diretor ou o administrador pode aprovar ou rejeitar propostas';
  end if;
  if pr.status <> 'Pendente' then raise exception 'A proposta nº % não está pendente (status: %)', pr.numero, pr.status; end if;
  if not p_aprovar then
    update fidc_propostas set status = 'Rejeitada', motivo = p_motivo, aprovado_por = auth.uid(), aprovado_em = now() where id = p_id;
    return 'Rejeitada';
  end if;
  return _aprovar_proposta_fidc(p_id, p_motivo, auth.uid());
end $$;
revoke execute on function public.decidir_proposta_fidc(uuid, boolean, text) from anon, public;
grant execute on function public.decidir_proposta_fidc(uuid, boolean, text) to authenticated;


-- ===== 20261021000049_operacoes_atomicas.sql =====
-- Operações em um passo só + desfazer (21/10/2026).
-- Motivo: correções feitas em vários passos (baixar o título, mover a conciliação, excluir o duplicado) ficavam pela
-- metade quando um passo falhava ou era cancelado. Aqui:
--  1) auditoria.operacao: cada alteração feita dentro de uma operação leva o mesmo número (lote), para ver e desfazer junto;
--  2) mesclar_lancamentos(manter, excluir): une dois lançamentos que são o mesmo fato (ex.: título da NF em aberto +
--     recebimento importado do extrato/ERP) numa transação só: o que fica assume data/conta/status do pagamento, recebe
--     conciliações, vínculos de nota, borderô, créditos etc., e o outro é excluído. Ou tudo, ou nada;
--  3) baixar_parcial(título, valor, data, conta): baixa só o recebido; o saldo continua em aberto (mesma NF/parcela);
--  4) desfazer_operacao(lote) e desfazer_auditoria(id): volta o que foi registrado na auditoria (inclusão → exclui,
--     exclusão → recria, alteração → volta os campos), só se o registro não mudou de novo depois. Admin/diretor.
-- Aditivo: não altera nem apaga dados existentes. Pode rodar mais de uma vez.

alter table public.auditoria add column if not exists operacao uuid;
alter table public.auditoria add column if not exists operacao_nome text;
create index if not exists auditoria_operacao on public.auditoria(operacao) where operacao is not null;

-- _auditar: igual à versão 038, agora gravando o lote da operação em andamento (app.operacao), se houver
create or replace function public._auditar() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  r_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  r jsonb := coalesce(r_new, r_old);
  v_emp uuid := (r ->> 'empresa_id')::uuid;
  v_reg text := coalesce(r ->> 'id', r ->> 'plano_id', r ->> 'conta_bancaria_id',
                         (r ->> 'favorecido_id') || coalesce(':' || (r ->> 'papel'), ''), r ->> 'user_id');
  v_op uuid := nullif(current_setting('app.operacao', true), '')::uuid;
  v_opn text := nullif(current_setting('app.operacao_nome', true), '');
  ign text[] := array['updated_at', 'created_at', 'atualizado_em', 'criado_em', 'xml'];
  k text; mudou text[] := '{}'; a jsonb := '{}'; d jsonb := '{}';
begin
  if v_emp is null then return null; end if;
  if tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(r_new) loop
      if k = any(ign) then continue; end if;
      if (r_old -> k) is distinct from (r_new -> k) then
        mudou := mudou || k; a := a || jsonb_build_object(k, r_old -> k); d := d || jsonb_build_object(k, r_new -> k);
      end if;
    end loop;
    if cardinality(mudou) = 0 then return null; end if;
    insert into auditoria(empresa_id, user_id, user_email, tabela, registro_id, acao, campos, antes, depois, operacao, operacao_nome)
    values (v_emp, auth.uid(), auth.jwt() ->> 'email', tg_table_name, v_reg, 'alterou', mudou, a, d, v_op, v_opn);
  else
    -- na exclusão guarda o registro inteiro (inclusive created_at) para poder recriar igual
    insert into auditoria(empresa_id, user_id, user_email, tabela, registro_id, acao, antes, depois, operacao, operacao_nome)
    values (v_emp, auth.uid(), auth.jwt() ->> 'email', tg_table_name, v_reg,
            case tg_op when 'INSERT' then 'incluiu' else 'excluiu' end,
            case when tg_op = 'DELETE' then r_old - 'xml' end, case when tg_op = 'INSERT' then r_new - ign end, v_op, v_opn);
  end if;
  return null;
end $$;
revoke all on function public._auditar() from public, anon, authenticated;

-- quem pode: chamada pelo app (usuário com papel) ou direto no banco (SQL Editor / manutenção, sem JWT)
create or replace function public._pode_operar(p_empresa uuid, p_papeis text[])
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is null and coalesce(auth.jwt() ->> 'role', '') not in ('anon', 'authenticated')
      or exists (select 1 from membros where empresa_id = p_empresa and user_id = auth.uid() and papel::text = any(p_papeis));
$$;
revoke all on function public._pode_operar(uuid, text[]) from public, anon, authenticated;

-- abre um lote de operação (vale até o fim da transação)
create or replace function public._iniciar_operacao(p_nome text) returns uuid
language plpgsql set search_path = public as $$
declare v uuid := gen_random_uuid();
begin
  perform set_config('app.operacao', v::text, true);
  perform set_config('app.operacao_nome', left(p_nome, 200), true);
  return v;
end $$;
revoke all on function public._iniciar_operacao(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Mesclar dois lançamentos que são o mesmo fato
-- ---------------------------------------------------------------------------------------------
create or replace function public.mesclar_lancamentos(p_manter uuid, p_excluir uuid, p_motivo text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  a lancamentos; b lancamentos; na text; nb text; v_op uuid; fk record; n int; movidos jsonb := '{}';
  conc_a boolean; muda boolean;
begin
  if p_manter = p_excluir then raise exception 'Escolha dois lançamentos diferentes'; end if;
  select * into a from lancamentos where id = p_manter for update;
  select * into b from lancamentos where id = p_excluir for update;
  if a.id is null or b.id is null then raise exception 'Lançamento não encontrado'; end if;
  if a.empresa_id <> b.empresa_id then raise exception 'Lançamentos de empresas diferentes'; end if;
  if not _pode_operar(a.empresa_id, array['admin', 'financeiro']) then raise exception 'Sem permissão para mesclar lançamentos'; end if;
  if abs(a.valor - b.valor) >= 0.005 then raise exception 'Valores diferentes (% × %): mesclar só une lançamentos do mesmo valor', a.valor, b.valor; end if;
  select natureza into na from plano_contas where id = a.plano_id;
  select natureza into nb from plano_contas where id = b.plano_id;
  if na is distinct from nb then raise exception 'Um é entrada e o outro é saída: não são o mesmo fato'; end if;
  if a.conta_destino_id is not null or b.conta_destino_id is not null then raise exception 'Transferências não são mescladas por aqui'; end if;
  if a.fidc_proposta_id is not null and b.fidc_proposta_id is not null and a.fidc_proposta_id <> b.fidc_proposta_id then
    raise exception 'Os dois estão em borderôs diferentes'; end if;

  v_op := _iniciar_operacao(coalesce('Mesclar: ' || p_motivo, 'Mesclar lançamentos') || ' — mantém ' || coalesce(a.documento, left(a.descricao, 40)));

  -- o que fica assume o pagamento (data, conta, status) quando ele é o título em aberto e o outro já está pago
  conc_a := exists (select 1 from conciliacoes where lancamento_id = a.id);
  muda := a.status <> 'Pago' and b.status = 'Pago';
  if muda then
    if conc_a then raise exception 'O lançamento que fica já está conciliado e precisaria mudar de data/conta'; end if;
    update lancamentos set status = 'Pago', data = b.data, conta_id = coalesce(b.conta_id, a.conta_id),
           fidc_proposta_id = coalesce(a.fidc_proposta_id, b.fidc_proposta_id), updated_at = now()
     where id = a.id;
  elsif a.fidc_proposta_id is null and b.fidc_proposta_id is not null and not conc_a then
    update lancamentos set fidc_proposta_id = b.fidc_proposta_id where id = a.id;
  end if;

  -- leva tudo que aponta para o excluído (conciliação, nota, borderô, crédito, autorização, duplicata…)
  for fk in select c.conrelid::regclass::text t, att.attname col
              from pg_constraint c join pg_attribute att on att.attrelid = c.conrelid and att.attnum = c.conkey[1]
             where c.contype = 'f' and c.confrelid = 'public.lancamentos'::regclass and cardinality(c.conkey) = 1 loop
    begin
      execute format('update %s set %I = $1 where %I = $2', fk.t, fk.col, fk.col) using a.id, b.id;
      get diagnostics n = row_count;
      if n > 0 then movidos := movidos || jsonb_build_object(fk.t, n); end if;
    exception when unique_violation then
      raise exception 'Os dois já estão ligados ao mesmo item em % (ex.: conciliados na mesma conta): revise antes de mesclar', fk.t;
    end;
  end loop;

  delete from lancamentos where id = b.id;
  return jsonb_build_object('operacao', v_op, 'mantido', a.id, 'excluido', b.id, 'assumiu_pagamento', muda, 'movidos', movidos);
end $$;
revoke all on function public.mesclar_lancamentos(uuid, uuid, text) from public, anon;
grant execute on function public.mesclar_lancamentos(uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Baixa parcial de um título em aberto: o título vira o valor recebido (Pago) e o saldo continua em aberto num
-- título novo, com o mesmo documento, nota e vencimento. Até existir o modelo de baixas (título × várias baixas).
-- ---------------------------------------------------------------------------------------------
create or replace function public.baixar_parcial(p_titulo uuid, p_valor numeric, p_data date, p_conta uuid, p_motivo text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t lancamentos; v_novo uuid; v_saldo numeric; v_op uuid;
begin
  select * into t from lancamentos where id = p_titulo for update;
  if t.id is null then raise exception 'Título não encontrado'; end if;
  if not _pode_operar(t.empresa_id, array['admin', 'financeiro']) then raise exception 'Sem permissão para baixar títulos'; end if;
  if t.status <> 'Em aberto' then raise exception 'O título % não está em aberto', coalesce(t.documento, t.id::text); end if;
  p_valor := round(p_valor, 2); v_saldo := round(t.valor - p_valor, 2);
  if p_valor <= 0 or v_saldo <= 0 then raise exception 'Valor da baixa parcial deve ser maior que zero e menor que o título (%)', t.valor; end if;
  v_op := _iniciar_operacao(coalesce('Baixa parcial: ' || p_motivo, 'Baixa parcial') || ' — ' || coalesce(t.documento, left(t.descricao, 40)));
  insert into lancamentos(empresa_id, data, plano_id, descricao, opc1, opc2, opc3, opc4, favorecido_id, centro_custo_id, status, conta_id, valor,
                          prioridade, origem, created_by, documento, emissao)
  values (t.empresa_id, t.data, t.plano_id, left(t.descricao || ' (saldo)', 500), t.opc1, t.opc2, t.opc3, t.opc4, t.favorecido_id, t.centro_custo_id,
          'Em aberto', t.conta_id, v_saldo, t.prioridade, t.origem, auth.uid(), t.documento, t.emissao)
  returning id into v_novo;
  update lancamentos set status = 'Pago', valor = p_valor, data = p_data, conta_id = coalesce(p_conta, conta_id), updated_at = now() where id = t.id;
  -- o saldo fica ligado à mesma nota/parcela
  insert into nfe_vinculos(empresa_id, nota_id, parcela_id, lancamento_id, tipo)
  select empresa_id, nota_id, parcela_id, v_novo, tipo from nfe_vinculos where lancamento_id = t.id and tipo = 'titulo';
  return jsonb_build_object('operacao', v_op, 'baixado', t.id, 'saldo_id', v_novo, 'saldo', v_saldo);
end $$;
revoke all on function public.baixar_parcial(uuid, numeric, date, uuid, text) from public, anon;
grant execute on function public.baixar_parcial(uuid, numeric, date, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Desfazer pela auditoria
-- ---------------------------------------------------------------------------------------------
create or replace function public._desfazer_um(r auditoria) returns text
language plpgsql security definer set search_path = public as $$
declare
  t text := 'public.' || quote_ident(r.tabela); cols text; atual jsonb; k text;
begin
  if r.registro_id is null or not exists (select 1 from pg_attribute where attrelid = t::regclass and attname = 'id' and not attisdropped) then
    raise exception 'Registro % de % não pode ser desfeito automaticamente', r.registro_id, r.tabela; end if;
  execute format('select to_jsonb(x) from %s x where x.id::text = $1', t) into atual using r.registro_id;
  if r.acao = 'incluiu' then
    if atual is null then return 'já não existia'; end if;
    for k in select jsonb_object_keys(r.depois) loop
      if (atual -> k) is distinct from (r.depois -> k) then raise exception '% % mudou depois da inclusão (campo %): desfaça as mudanças mais novas antes', r.tabela, r.registro_id, k; end if;
    end loop;
    execute format('delete from %s where id::text = $1', t) using r.registro_id;
    return 'excluído';
  elsif r.acao = 'excluiu' then
    if atual is not null then return 'já existia'; end if;
    select string_agg(quote_ident(attname), ',') into cols from pg_attribute
     where attrelid = t::regclass and attnum > 0 and not attisdropped and attgenerated = '' and r.antes ? attname;
    execute format('insert into %s (%s) select %s from jsonb_populate_record(null::%s, $1)', t, cols, cols, t) using r.antes;
    return 'recriado';
  else
    if atual is null then raise exception '% % foi excluído depois: desfaça a exclusão antes', r.tabela, r.registro_id; end if;
    foreach k in array r.campos loop
      if (atual -> k) is distinct from (r.depois -> k) then raise exception '% % mudou de novo depois (campo %): desfaça as mudanças mais novas antes', r.tabela, r.registro_id, k; end if;
    end loop;
    select string_agg(quote_ident(c), ',') into cols from unnest(r.campos) c;
    execute format('update %s set (%s) = (select %s from jsonb_populate_record(null::%s, $1)) where id::text = $2', t, cols, cols, t)
      using r.antes, r.registro_id;
    return 'voltou';
  end if;
end $$;
revoke all on function public._desfazer_um(auditoria) from public, anon, authenticated;

create or replace function public.desfazer_operacao(p_operacao uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r auditoria; v_emp uuid; res jsonb := '[]'; v_nome text;
begin
  select empresa_id, operacao_nome into v_emp, v_nome from auditoria where operacao = p_operacao limit 1;
  if v_emp is null then raise exception 'Operação não encontrada'; end if;
  if not _pode_operar(v_emp, array['admin', 'diretor']) then raise exception 'Somente o administrador ou o diretor pode desfazer'; end if;
  perform _iniciar_operacao('Desfazer: ' || coalesce(v_nome, p_operacao::text));
  -- de trás para frente; a trava de conciliação é respeitada porque a ordem inversa recria a conciliação por último
  for r in select * from auditoria where operacao = p_operacao order by id desc loop
    res := res || jsonb_build_object('tabela', r.tabela, 'registro', r.registro_id, 'acao', r.acao, 'resultado', _desfazer_um(r));
  end loop;
  return res;
end $$;
revoke all on function public.desfazer_operacao(uuid) from public, anon;
grant execute on function public.desfazer_operacao(uuid) to authenticated;

create or replace function public.desfazer_auditoria(p_id bigint)
returns text language plpgsql security definer set search_path = public as $$
declare r auditoria;
begin
  select * into r from auditoria where id = p_id;
  if r.id is null then raise exception 'Registro de auditoria não encontrado'; end if;
  if r.operacao is not null then return desfazer_operacao(r.operacao)::text; end if;
  if not _pode_operar(r.empresa_id, array['admin', 'diretor']) then raise exception 'Somente o administrador ou o diretor pode desfazer'; end if;
  perform _iniciar_operacao('Desfazer alteração ' || p_id);
  return _desfazer_um(r);
end $$;
revoke all on function public.desfazer_auditoria(bigint) from public, anon;
grant execute on function public.desfazer_auditoria(bigint) to authenticated;

-- conferência: deve listar as 4 funções
select proname from pg_proc where proname in ('mesclar_lancamentos', 'baixar_parcial', 'desfazer_operacao', 'desfazer_auditoria') order by 1;

-- ===== 20261022000050_fidc_condicoes_sacado.sql =====
-- Condições do fundo por grupo de sacados (22/10/2026).
-- Motivo: a FS cobra uma taxa para um grupo de sacados (CNPJ raiz informado) e outra para os demais, e nunca mistura
-- os dois no mesmo borderô — por isso há dias com duas operações na FS. Cada fundo pode ter várias condições:
--   sacados_raiz = raízes de CNPJ (8 dígitos) que a condição cobre; vazio = "demais sacados";
--   compensação = vencimento + N dias corridos, rolando para o próximo dia útil quando cair em fim de semana/feriado;
--   vigência (contratos que mudam a taxa).
-- Sem condição cadastrada, o fundo continua usando os campos de fidc_fundos (como hoje).
-- Aditivo: só cria tabela e coluna; não altera dados. Pode rodar mais de uma vez.

create table if not exists public.fidc_fundo_condicoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  fundo_id uuid not null references public.fidc_fundos(id) on delete cascade,
  nome text not null,
  sacados_raiz text[] not null default '{}',          -- raízes de CNPJ (8 dígitos); vazio = demais sacados
  taxa_am numeric(8,4) not null,
  metodo_desagio text not null default 'simples' check (metodo_desagio in ('simples', 'fator')),
  dias_compensacao int not null default 0,
  rola_dia_util boolean not null default true,        -- data cobrada cai em fim de semana/feriado → próximo dia útil
  prazo_min_cobrado int,                              -- prazo mínimo cobrado (dias), se o fundo tiver
  tarifa_operacao numeric(12,2) not null default 0,   -- TED / tarifa por borderô
  custo_assinatura numeric(12,2) not null default 0,  -- assinatura por borderô
  tarifa_titulo numeric(12,2) not null default 0,     -- boleto por título
  custo_consulta numeric(12,2) not null default 0,    -- consulta de sacado novo
  ad_valorem_pct numeric(8,4) not null default 0,
  iof_pct numeric(8,4) not null default 0,
  vigencia_ini date,
  vigencia_fim date,
  ativo boolean not null default true,
  observacao text,
  criado_em timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists fidc_fundo_condicoes_fundo on public.fidc_fundo_condicoes(fundo_id);

alter table public.fidc_fundo_condicoes enable row level security;
drop policy if exists fidc_cond_sel on public.fidc_fundo_condicoes;
drop policy if exists fidc_cond_ins on public.fidc_fundo_condicoes;
drop policy if exists fidc_cond_upd on public.fidc_fundo_condicoes;
drop policy if exists fidc_cond_del on public.fidc_fundo_condicoes;
create policy fidc_cond_sel on public.fidc_fundo_condicoes for select to authenticated using (public.is_membro(empresa_id));
create policy fidc_cond_ins on public.fidc_fundo_condicoes for insert to authenticated with check (public.pode_editar(empresa_id));
create policy fidc_cond_upd on public.fidc_fundo_condicoes for update to authenticated using (public.pode_editar(empresa_id)) with check (public.pode_editar(empresa_id));
create policy fidc_cond_del on public.fidc_fundo_condicoes for delete to authenticated using (public.pode_editar(empresa_id));
revoke all on public.fidc_fundo_condicoes from anon;
grant select, insert, update, delete on public.fidc_fundo_condicoes to authenticated;

-- a proposta guarda a condição usada (uma proposta = uma condição, como o borderô do fundo)
alter table public.fidc_propostas add column if not exists condicao_id uuid references public.fidc_fundo_condicoes(id) on delete set null;

-- auditoria (migração 038)
drop trigger if exists zz_auditoria on public.fidc_fundo_condicoes;
create trigger zz_auditoria after insert or update or delete on public.fidc_fundo_condicoes for each row execute function public._auditar();

-- conferência: deve mostrar 1 tabela e 1 coluna
select (select count(*) from information_schema.tables where table_name = 'fidc_fundo_condicoes') tabela,
       (select count(*) from information_schema.columns where table_name = 'fidc_propostas' and column_name = 'condicao_id') coluna;

-- ===== 20261022000051_fidc_recesso_vencimento.sql =====
-- Recesso do fundo e vencimento ajustado na proposta de borderô (22/10/2026).
-- 1) fidc_fundos.recessos: períodos sem expediente do fundo, [{"de":"2026-12-20","ate":"2027-01-07","cobra_ate":"2027-01-07"}].
--    Quando a data cobrada (vencimento + compensação) cai dentro do período, o fundo cobra até "cobra_ate" (padrão: "ate").
--    Ex.: FS, recesso de 20/12/2026 a 07/01/2027 — título de 21/12 cobrado até 07/01 (borderôs de 21 e 22/10/2026).
-- 2) fidc_proposta_itens.vencimento_original: quando o vencimento é ajustado na proposta, "vencimento" guarda o ajustado
--    (é ele que vai para a carteira do fundo na aprovação) e este campo guarda o da nota.
-- Aditivo: não altera dados. Pode rodar mais de uma vez.

alter table public.fidc_fundos add column if not exists recessos jsonb not null default '[]'::jsonb;
alter table public.fidc_proposta_itens add column if not exists vencimento_original date;

-- conferência: deve mostrar 2
select count(*) from information_schema.columns
 where (table_name = 'fidc_fundos' and column_name = 'recessos') or (table_name = 'fidc_proposta_itens' and column_name = 'vencimento_original');

-- ===== 20261027000052_rh_base.sql =====
-- =====================================================================
-- RH / Trabalhista — etapa 1 (27/10/2026, Renan: "pode seguir sua sugestão"):
--   colaboradores, histórico de salário, folha por competência (mensal e 13º) e os pagamentos da folha
--   viram PREVISÃO de caixa (lançamentos "Em aberto", origem rh:<evento>) — a folha continua sendo feita no Iniflex/contabilidade.
-- Sigilo: salário é dado sensível. Só vê e altera o RH quem é administrador ou tem a área "rh" marcada
--   (diferente das outras áreas, "sem marcação" NÃO dá acesso ao RH). Papel "leitura" com área RH só consulta.
--   A auditoria das tabelas rh_* também só aparece para quem tem acesso ao RH.
-- Migração ADITIVA: não altera nenhum dado existente. Pode rodar mais de uma vez.
-- =====================================================================

-- área "rh" no cadastro de membros
alter table public.membros drop constraint if exists membros_areas_validas;
alter table public.membros add constraint membros_areas_validas
  check (areas is null or (cardinality(areas) > 0 and areas <@ array['fin', 'com', 'cmp', 'prd', 'log', 'cpd', 'cont', 'rh']::text[]));

create or replace function public.ve_rh(p_empresa uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from membros where empresa_id = p_empresa and user_id = auth.uid()
                and (papel::text = 'admin' or 'rh' = any(coalesce(areas, '{}'::text[]))));
$$;
create or replace function public.edita_rh(p_empresa uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from membros where empresa_id = p_empresa and user_id = auth.uid()
                and (papel::text = 'admin' or ('rh' = any(coalesce(areas, '{}'::text[])) and papel::text not in ('leitura', 'vendas', 'producao'))));
$$;
revoke execute on function public.ve_rh(uuid), public.edita_rh(uuid) from anon, public;
grant execute on function public.ve_rh(uuid), public.edita_rh(uuid) to authenticated;

-- ---------------------------------------------------------------------
create table if not exists public.rh_parametros (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null unique references public.empresas(id) on delete cascade,
  conta_id uuid references public.contas(id) on delete set null,      -- conta que paga a folha (ex.: Unicred Subconta)
  pct_adiantamento numeric(5,2), dia_adiantamento smallint, dia_util_saldo smallint, fator_liquido numeric(5,2),
  dia_guias smallint, inss_pct numeric(5,2), fgts_pct numeric(5,2), irrf_mensal numeric(14,2), desc13_pct numeric(5,2),
  planos jsonb not null default '{}'::jsonb,                           -- {"salarios": plano_id, "inss": …, "fgts": …, "irrf": …, "decimo": …}
  atualizado_em timestamptz not null default now()
);

create table if not exists public.rh_colaboradores (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  matricula text,
  nome text not null,
  cpf text,                                                            -- só dígitos
  cargo text,
  setor text,
  centro_custo_id uuid references public.centros_custo(id) on delete set null,
  vinculo text not null default 'clt' check (vinculo in ('clt', 'aprendiz', 'estagio', 'extra_folha', 'pro_labore')),
  situacao text not null default 'ativo' check (situacao in ('ativo', 'afastado', 'desligado')),
  admissao date,
  demissao date,
  salario numeric(12,2) check (salario is null or salario >= 0),
  pix text,
  observacao text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists rh_colab_emp on public.rh_colaboradores(empresa_id, nome);
create unique index if not exists rh_colab_matricula on public.rh_colaboradores(empresa_id, matricula) where matricula is not null and matricula <> '';
create unique index if not exists rh_colab_cpf on public.rh_colaboradores(empresa_id, cpf) where cpf is not null and cpf <> '';

-- histórico de salário e cargo (gravado sozinho a cada inclusão/alteração)
create table if not exists public.rh_salarios (
  id bigserial primary key,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  colaborador_id uuid not null references public.rh_colaboradores(id) on delete cascade,
  vigencia date not null default current_date,
  salario numeric(12,2),
  cargo text,
  criado_por uuid default auth.uid(),
  criado_em timestamptz not null default now()
);
create index if not exists rh_salarios_colab on public.rh_salarios(colaborador_id, vigencia desc);

-- BEFORE: atualizado_em; AFTER: histórico (o id já existe na inclusão)
create or replace function public.tg_rh_colab_upd() returns trigger language plpgsql as $$ begin new.atualizado_em := now(); return new; end $$;
create or replace function public.tg_rh_colab_hist() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.salario is distinct from old.salario or new.cargo is distinct from old.cargo then
    insert into rh_salarios(empresa_id, colaborador_id, salario, cargo) values (new.empresa_id, new.id, new.salario, new.cargo);
  end if;
  return null;
end $$;
drop trigger if exists rh_colab_upd on public.rh_colaboradores;
drop trigger if exists rh_colab_hist on public.rh_colaboradores;
create trigger rh_colab_upd before update on public.rh_colaboradores for each row execute function public.tg_rh_colab_upd();
create trigger rh_colab_hist after insert or update on public.rh_colaboradores for each row execute function public.tg_rh_colab_hist();

-- folha por competência: mensal (competência = 1º dia do mês) ou 13º (competência = 1º de dezembro do ano)
create table if not exists public.rh_folhas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  competencia date not null check (extract(day from competencia) = 1),
  tipo text not null default 'mensal' check (tipo in ('mensal', 'decimo')),
  status text not null default 'aberta' check (status in ('aberta', 'prevista', 'encerrada')),
  parametros jsonb,                                                    -- parâmetros usados no cálculo
  observacao text,
  criado_por uuid default auth.uid(),
  criado_em timestamptz not null default now(),
  unique (empresa_id, competencia, tipo)
);

create table if not exists public.rh_folha_itens (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  folha_id uuid not null references public.rh_folhas(id) on delete cascade,
  colaborador_id uuid not null references public.rh_colaboradores(id) on delete restrict,
  salario numeric(12,2) not null default 0,
  avos smallint,                                                       -- 13º
  bruto numeric(12,2),                                                 -- 13º
  proventos numeric(12,2) not null default 0,                          -- horas extras, adicionais, médias
  descontos numeric(12,2) not null default 0,
  adiantamento numeric(12,2) not null default 0,                       -- mensal: adiantamento; 13º: 1ª parcela
  liquido numeric(12,2) not null default 0,                            -- mensal: saldo; 13º: 2ª parcela
  adiant_pago numeric(12,2) not null default 0,                        -- 13º já adiantado (férias / pedido)
  observacao text,
  unique (folha_id, colaborador_id)
);
create index if not exists rh_itens_colab on public.rh_folha_itens(colaborador_id);

-- pagamentos da folha (o que vai para o caixa)
create table if not exists public.rh_folha_eventos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  folha_id uuid not null references public.rh_folhas(id) on delete cascade,
  evento text not null,
  descricao text,
  vencimento date not null,
  valor numeric(14,2) not null check (valor >= 0),
  plano_id uuid references public.plano_contas(id) on delete set null,
  conta_id uuid references public.contas(id) on delete set null,
  lancamento_id uuid references public.lancamentos(id) on delete set null,   -- previsão lançada (Em aberto)
  unique (folha_id, evento)
);
create index if not exists rh_eventos_lanc on public.rh_folha_eventos(lancamento_id);

-- ---------------------------------------------------------------------
-- RLS: só quem tem acesso ao RH
do $$ declare t text; begin
  foreach t in array array['rh_parametros', 'rh_colaboradores', 'rh_salarios', 'rh_folhas', 'rh_folha_itens', 'rh_folha_eventos'] loop
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
    if t <> 'rh_salarios' then
      execute format('drop trigger if exists zz_auditoria on public.%I', t);
      execute format('create trigger zz_auditoria after insert or update or delete on public.%I for each row execute function public._auditar()', t);
    end if;
  end loop;
end $$;
grant usage on sequence public.rh_salarios_id_seq to authenticated;

-- auditoria: registros das tabelas rh_* só para quem tem acesso ao RH
drop policy if exists auditoria_sel on public.auditoria;
create policy auditoria_sel on public.auditoria for select to authenticated using (
  exists (select 1 from public.membros m where m.empresa_id = auditoria.empresa_id and m.user_id = (select auth.uid())
          and m.papel::text in ('admin', 'diretor'))
  and (auditoria.tabela not like 'rh\_%' or public.ve_rh(auditoria.empresa_id)));

-- ---------------------------------------------------------------------
-- Lança (ou atualiza) a previsão de caixa dos eventos da folha: um lançamento "Em aberto" por evento.
-- Quem tem acesso ao RH mas não é do financeiro também consegue (security definer), só para a própria folha.
-- Lançamento já pago não é tocado.
create or replace function public.rh_lancar_previsao(p_folha uuid)
returns int language plpgsql security definer set search_path = public as $$
declare f rh_folhas; e rh_folha_eventos; v_l lancamentos; n int := 0; v_desc text; v_comp text;
begin
  select * into f from rh_folhas where id = p_folha;
  if f.id is null then raise exception 'Folha não encontrada'; end if;
  if not public.edita_rh(f.empresa_id) then raise exception 'Sem permissão no RH'; end if;
  if f.status = 'encerrada' then raise exception 'Folha encerrada: reabra antes de lançar a previsão'; end if;
  v_comp := case when f.tipo = 'decimo' then '13º ' || to_char(f.competencia, 'YYYY') else 'folha ' || to_char(f.competencia, 'MM/YYYY') end;
  for e in select * from rh_folha_eventos where folha_id = p_folha loop
    if e.plano_id is null then raise exception 'Evento % sem plano de contas', e.evento; end if;
    v_desc := 'RH ' || v_comp || ' — ' || coalesce(e.descricao, e.evento) || ' (previsão)';
    v_l := null;
    if e.lancamento_id is not null then select * into v_l from lancamentos where id = e.lancamento_id; end if;
    if v_l.id is not null and v_l.status <> 'Em aberto' then continue; end if;
    if e.valor <= 0 then
      if v_l.id is not null then delete from lancamentos where id = v_l.id; update rh_folha_eventos set lancamento_id = null where id = e.id; end if;
      continue;
    end if;
    if v_l.id is not null then
      update lancamentos set data = e.vencimento, valor = e.valor, plano_id = e.plano_id, conta_id = e.conta_id, descricao = v_desc where id = v_l.id;
    else
      insert into lancamentos(empresa_id, data, plano_id, descricao, status, conta_id, valor, origem, documento)
      values (f.empresa_id, e.vencimento, e.plano_id, v_desc, 'Em aberto', e.conta_id, e.valor, 'rh:' || e.id,
              'RH-' || to_char(f.competencia, 'YYYYMM') || '-' || e.evento)
      returning * into v_l;
      update rh_folha_eventos set lancamento_id = v_l.id where id = e.id;
    end if;
    n := n + 1;
  end loop;
  update rh_folhas set status = 'prevista' where id = p_folha;
  return n;
end $$;

-- Retira as previsões em aberto (o realizado já entrou pelo ERP/extrato) e encerra a folha; p_reabrir = volta para "aberta".
create or replace function public.rh_encerrar_folha(p_folha uuid, p_reabrir boolean default false)
returns int language plpgsql security definer set search_path = public as $$
declare f rh_folhas; n int := 0;
begin
  select * into f from rh_folhas where id = p_folha;
  if f.id is null then raise exception 'Folha não encontrada'; end if;
  if not public.edita_rh(f.empresa_id) then raise exception 'Sem permissão no RH'; end if;
  if p_reabrir then update rh_folhas set status = 'aberta' where id = p_folha; return 0; end if;
  with x as (
    delete from lancamentos l using rh_folha_eventos e
     where e.folha_id = p_folha and l.id = e.lancamento_id and l.status = 'Em aberto' and l.origem = 'rh:' || e.id
    returning l.id)
  select count(*) into n from x;
  update rh_folha_eventos set lancamento_id = null where folha_id = p_folha and lancamento_id is not null
    and not exists (select 1 from lancamentos l where l.id = rh_folha_eventos.lancamento_id);
  update rh_folhas set status = 'encerrada' where id = p_folha;
  return n;
end $$;

-- Exclui a folha (e as previsões em aberto dela)
create or replace function public.rh_excluir_folha(p_folha uuid)
returns void language plpgsql security definer set search_path = public as $$
declare f rh_folhas;
begin
  select * into f from rh_folhas where id = p_folha;
  if f.id is null then return; end if;
  if not public.edita_rh(f.empresa_id) then raise exception 'Sem permissão no RH'; end if;
  delete from lancamentos l using rh_folha_eventos e
   where e.folha_id = p_folha and l.id = e.lancamento_id and l.status = 'Em aberto' and l.origem = 'rh:' || e.id;
  delete from rh_folhas where id = p_folha;
end $$;

revoke execute on function public.rh_lancar_previsao(uuid), public.rh_encerrar_folha(uuid, boolean), public.rh_excluir_folha(uuid) from anon, public;
grant execute on function public.rh_lancar_previsao(uuid), public.rh_encerrar_folha(uuid, boolean), public.rh_excluir_folha(uuid) to authenticated;

-- conferência: deve mostrar 6 tabelas
select count(*) as tabelas_rh from information_schema.tables where table_schema = 'public' and table_name like 'rh\_%';

-- ===== 20261028000053_pa_pagamentos_anexos.sql =====
-- =====================================================================
-- Pagamento Antecipado com vários pagamentos e vários anexos (28/10/2026, Renan: "pode seguir").
-- Caso que motivou: PA nº 22 devia R$ 8.459,24 e foi pago R$ 6.987,62 — o complemento sai num segundo pagamento,
-- com o próprio comprovante.
--  - paraquedas_pagamentos: cada pagamento do PA (data, valor, conta) com o seu lançamento e o seu adiantamento ao fornecedor
--  - paraquedas_anexos: vários arquivos por PA (comprovantes ligados a um pagamento, ou outros documentos)
--  - RPCs atômicas: pa_registrar_pagamento, pa_corrigir_pagamento, pa_excluir_anexo
--  - PAs que já existem: cada lançamento ligado vira o "pagamento 1" e o comprovante atual vira o anexo dele
--    (só copia referências; nenhum valor muda). Pode rodar mais de uma vez.
-- =====================================================================

create table if not exists public.paraquedas_pagamentos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  paraquedas_id uuid not null references public.paraquedas(id) on delete cascade,
  lancamento_id uuid unique references public.lancamentos(id) on delete set null,
  credito_id uuid references public.creditos(id) on delete set null,
  data date not null,
  valor numeric(16,2) not null check (valor > 0),
  conta_id uuid references public.contas(id) on delete set null,
  observacao text,
  criado_por uuid default auth.uid(),
  criado_em timestamptz not null default now()
);
create index if not exists pa_pag_pa on public.paraquedas_pagamentos(paraquedas_id);

create table if not exists public.paraquedas_anexos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  paraquedas_id uuid not null references public.paraquedas(id) on delete cascade,
  pagamento_id uuid references public.paraquedas_pagamentos(id) on delete set null,
  tipo text not null default 'comprovante' check (tipo in ('comprovante', 'documento')),
  path text not null unique,
  nome text,
  enviado_por text,
  enviado_em timestamptz not null default now()
);
create index if not exists pa_anx_pa on public.paraquedas_anexos(paraquedas_id);

do $$ declare t text; begin
  foreach t in array array['paraquedas_pagamentos', 'paraquedas_anexos'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_sel', t);
    execute format('drop policy if exists %I on public.%I', t || '_ins', t);
    execute format('drop policy if exists %I on public.%I', t || '_upd', t);
    execute format('drop policy if exists %I on public.%I', t || '_del', t);
    -- vê: quem é da empresa (menos compras) ou quem lançou o PA
    execute format('create policy %I on public.%I for select to authenticated using (public.is_membro(empresa_id) or exists (select 1 from public.paraquedas p where p.id = paraquedas_id and p.criado_por = (select auth.uid())))', t || '_sel', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.pode_editar(empresa_id))', t || '_ins', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.pode_editar(empresa_id)) with check (public.pode_editar(empresa_id))', t || '_upd', t);
    execute format('create policy %I on public.%I for delete to authenticated using (public.pode_editar(empresa_id))', t || '_del', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('drop trigger if exists zz_auditoria on public.%I', t);
    execute format('create trigger zz_auditoria after insert or update or delete on public.%I for each row execute function public._auditar()', t);
  end loop;
end $$;

-- PAs que já existem: lançamento ligado → pagamento 1; comprovante atual → anexo do pagamento 1
insert into public.paraquedas_pagamentos (empresa_id, paraquedas_id, lancamento_id, credito_id, data, valor, conta_id, criado_por, criado_em)
select p.empresa_id, p.id, l.id, p.credito_id, l.data, l.valor, l.conta_id, p.criado_por, coalesce(p.atualizado_em, now())
  from public.paraquedas p join public.lancamentos l on l.id = p.lancamento_id
 where l.valor > 0 and not exists (select 1 from public.paraquedas_pagamentos x where x.lancamento_id = l.id);
insert into public.paraquedas_anexos (empresa_id, paraquedas_id, pagamento_id, tipo, path, nome, enviado_por, enviado_em)
select p.empresa_id, p.id, (select x.id from public.paraquedas_pagamentos x where x.paraquedas_id = p.id order by x.data, x.criado_em limit 1),
       'comprovante', p.comprovante_path, p.comprovante_nome, p.comprovante_por, coalesce(p.comprovante_em, now())
  from public.paraquedas p
 where p.comprovante_path is not null and not exists (select 1 from public.paraquedas_anexos a where a.path = p.comprovante_path);

-- ---------------------------------------------------------------------
-- Registra um pagamento (pago agora): lançamento Pago + adiantamento ao fornecedor (se terá nota e tem cadastro) + linha do pagamento.
-- Se houver lançamento programado "Em aberto" do PA, ele é reduzido pelo valor pago (some quando zera), para o fluxo não contar duas vezes.
-- O PA passa a "pago" no primeiro pagamento; enquanto faltar valor, a tela mostra "pago parcialmente — falta X".
create or replace function public.pa_registrar_pagamento(p_pa uuid, p_data date, p_valor numeric, p_conta uuid, p_obs text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare p paraquedas; v_pago numeric; v_n int; v_l uuid; v_c uuid; v_id uuid; r record; v_resta numeric := round(p_valor, 2);
begin
  select * into p from paraquedas where id = p_pa for update;
  if p.id is null then raise exception 'Pagamento antecipado não encontrado'; end if;
  if not pode_editar(p.empresa_id) then raise exception 'Só o financeiro registra pagamentos'; end if;
  if p.status not in ('aprovado', 'pago') then raise exception 'O PA nº % não está autorizado (situação: %)', p.numero, p.status; end if;
  if p_valor is null or p_valor <= 0 then raise exception 'Informe o valor pago'; end if;
  if p.plano_id is null then raise exception 'O PA nº % não tem plano de contas: programe ou edite a classificação antes', p.numero; end if;
  select coalesce(sum(x.valor), 0), count(*) into v_pago, v_n from paraquedas_pagamentos x join lancamentos l on l.id = x.lancamento_id
   where x.paraquedas_id = p.id and l.status = 'Pago';
  if v_pago + p_valor > p.valor + 0.005 then
    raise exception 'Passa do valor do PA nº %: já pago %, falta %', p.numero, translate(to_char(v_pago, 'FM999,999,990.00'), ',.', '.,'), translate(to_char(p.valor - v_pago, 'FM999,999,990.00'), ',.', '.,');
  end if;
  insert into lancamentos(empresa_id, data, plano_id, descricao, status, conta_id, centro_custo_id, favorecido_id, valor, origem, documento)
  values (p.empresa_id, p_data, p.plano_id, left('PA ' || p.numero || ' — ' || p.descricao || ' (pagamento ' || (v_n + 1) || ')', 250), 'Pago',
          p_conta, p.centro_custo_id, p.favorecido_id, round(p_valor, 2), 'paraquedas', 'PA ' || p.numero)
  returning id into v_l;
  if p.tera_nota and p.favorecido_id is not null then
    insert into creditos(empresa_id, favorecido_id, natureza, tipo, data, valor, descricao, lancamento_id)
    values (p.empresa_id, p.favorecido_id, 'fornecedor', 'adiantamento', p_data, round(p_valor, 2), left('PA ' || p.numero || ' — ' || p.descricao, 200), v_l)
    returning id into v_c;
  end if;
  insert into paraquedas_pagamentos(empresa_id, paraquedas_id, lancamento_id, credito_id, data, valor, conta_id, observacao)
  values (p.empresa_id, p.id, v_l, v_c, p_data, round(p_valor, 2), p_conta, nullif(trim(coalesce(p_obs, '')), '')) returning id into v_id;
  -- programado em aberto: reduz pelo valor pago
  for r in select x.id xid, l.id lid, l.valor from paraquedas_pagamentos x join lancamentos l on l.id = x.lancamento_id
            where x.paraquedas_id = p.id and l.status = 'Em aberto' order by l.data loop
    exit when v_resta <= 0;
    if r.valor <= v_resta + 0.005 then
      v_resta := v_resta - r.valor;
      delete from paraquedas_pagamentos where id = r.xid;
      if p.lancamento_id = r.lid then update paraquedas set lancamento_id = null where id = p.id; p.lancamento_id := null; end if;
      delete from lancamentos where id = r.lid;
    else
      update lancamentos set valor = round(r.valor - v_resta, 2) where id = r.lid;
      update paraquedas_pagamentos set valor = round(r.valor - v_resta, 2) where id = r.xid;
      v_resta := 0;
    end if;
  end loop;
  update paraquedas set lancamento_id = coalesce(lancamento_id, v_l), credito_id = coalesce(credito_id, v_c), conta_id = coalesce(conta_id, p_conta),
         status = 'pago'   -- saiu dinheiro: vira adiantamento; se faltar, a tela mostra "pago parcialmente — falta X"
   where id = p.id;
  return v_id;
end $$;

-- Corrige o valor de um pagamento já registrado (ex.: digitado o valor do PA, mas pago a menor).
-- Ajusta o lançamento e o adiantamento ao fornecedor juntos. Lançamento conciliado não muda (trava da conciliação).
create or replace function public.pa_corrigir_pagamento(p_pagamento uuid, p_valor numeric, p_data date default null)
returns void language plpgsql security definer set search_path = public as $$
declare x paraquedas_pagamentos; p paraquedas; v_outros numeric; v_usado numeric;
begin
  select * into x from paraquedas_pagamentos where id = p_pagamento for update;
  if x.id is null then raise exception 'Pagamento não encontrado'; end if;
  select * into p from paraquedas where id = x.paraquedas_id for update;
  if not pode_editar(x.empresa_id) then raise exception 'Só o financeiro corrige pagamentos'; end if;
  if p_valor is null or p_valor <= 0 then raise exception 'Informe o valor correto'; end if;
  select coalesce(sum(valor), 0) into v_outros from paraquedas_pagamentos where paraquedas_id = x.paraquedas_id and id <> x.id;
  if v_outros + p_valor > p.valor + 0.005 then raise exception 'Passa do valor do PA nº % (outros pagamentos: %)', p.numero, translate(to_char(v_outros, 'FM999,999,990.00'), ',.', '.,'); end if;
  if x.credito_id is not null then
    select coalesce(sum(valor), 0) into v_usado from creditos_usos where credito_id = x.credito_id;
    if v_usado > p_valor + 0.005 then raise exception 'O adiantamento deste pagamento já abateu % em nota; desfaça o abatimento antes', translate(to_char(v_usado, 'FM999,999,990.00'), ',.', '.,'); end if;
    update creditos set valor = round(p_valor, 2), data = coalesce(p_data, data) where id = x.credito_id;
  end if;
  if x.lancamento_id is not null then update lancamentos set valor = round(p_valor, 2), data = coalesce(p_data, data) where id = x.lancamento_id; end if;
  update paraquedas_pagamentos set valor = round(p_valor, 2), data = coalesce(p_data, data) where id = x.id;
  -- se ficou faltando, o PA continua "pago" e a tela mostra "pago parcialmente — falta X"
end $$;

revoke execute on function public.pa_registrar_pagamento(uuid, date, numeric, uuid, text), public.pa_corrigir_pagamento(uuid, numeric, date) from anon, public;
grant execute on function public.pa_registrar_pagamento(uuid, date, numeric, uuid, text), public.pa_corrigir_pagamento(uuid, numeric, date) to authenticated;

-- conferência: tabelas criadas e PAs já existentes copiados
select (select count(*) from public.paraquedas_pagamentos) as pagamentos, (select count(*) from public.paraquedas_anexos) as anexos,
       (select count(*) from public.paraquedas where lancamento_id is not null) as pas_com_lancamento;

-- ===== 20261028000054_fretes_ciot.sql =====
-- =====================================================================
-- Logística › Fretes e CIOT — etapas 1 e 2 da conformidade ANTT (28/10/2026, Renan: "pode seguir").
-- Base: Resolução ANTT 6.078/2026 (CIOT em toda operação; contratante de autônomo gera por IPEF; CIOT no MDF-e;
-- piso mínimo), MP 1.343/2026 (multa ao contratante abaixo do piso), NT MDF-e 2026.001 (MDF-e sem CIOT recusado a partir de 23/11/2026).
--  - log_transportadores: autônomo (tac), autônomo equiparado (tac_eq), transportadora (etc), cooperativa (ctc); RNTRC, conta indicada
--  - log_fretes: ficha de cada frete contratado (carga, NF-e, rota, km, eixos, valor × piso, CIOT, MDF-e, CT-e, vale-pedágio)
--  - log_frete_anexos: contrato, CIOT, MDF-e, CT-e, vale-pedágio, comprovantes (bucket privado "logistica")
--  - log_piso_coef: coeficientes do piso mínimo (CCD R$/km, CC R$) editáveis; carregada a Tabela A — carga geral, lotação
--  - trava: lançamento ligado a frete com autônomo só vira "Pago" sem pendências (CIOT, MDF-e, contrato, conta indicada, RNTRC, piso)
-- Migração ADITIVA. Pode rodar mais de uma vez.
-- =====================================================================

create table if not exists public.log_transportadores (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  favorecido_id uuid references public.favorecidos(id) on delete set null,
  nome text not null,
  documento text,                                     -- CPF ou CNPJ, só dígitos
  tipo text not null default 'etc' check (tipo in ('tac', 'tac_eq', 'etc', 'ctc')),
  rntrc text,
  rntrc_validade date,
  veiculos jsonb not null default '[]'::jsonb,        -- [{"placa":"ABC1D23","eixos":5,"tipo":"carreta"}]
  conta_banco text, conta_agencia text, conta_numero text, conta_pix text,
  conta_titular text,
  conta_vinculo text check (conta_vinculo in ('proprio', 'conjuge', 'parente')),   -- autônomo: conta dele, do cônjuge ou parente até 2º grau
  contrato_validade date,
  ipef text,
  observacao text,
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);
create unique index if not exists log_transp_doc on public.log_transportadores(empresa_id, documento) where documento is not null and documento <> '';

create table if not exists public.log_piso_coef (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  tabela text not null default 'A' check (tabela in ('A', 'B', 'C', 'D')),
  tipo_carga text not null default 'geral',
  eixos smallint not null check (eixos between 2 and 9),
  ccd numeric(10,4) not null,                          -- R$ por km
  cc numeric(10,2) not null,                           -- R$ carga e descarga
  vigencia date not null default current_date,
  fonte text,
  unique (empresa_id, tabela, tipo_carga, eixos, vigencia)
);

create table if not exists public.log_fretes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  numero int not null default 0,
  data date not null default current_date,
  transportador_id uuid references public.log_transportadores(id) on delete restrict,
  carga_id uuid references public.log_cargas(id) on delete set null,
  notas text,                                          -- números das NF-e transportadas
  origem text, destino text,
  km numeric(9,1),
  lotacao boolean not null default true,               -- piso só se aplica a carga lotação
  tabela text not null default 'A',
  tipo_carga text not null default 'geral',
  eixos smallint,
  retorno_vazio boolean not null default false,
  km_retorno numeric(9,1),
  valor numeric(14,2),
  piso numeric(14,2),                                  -- calculado na ficha (km × CCD + CC [+ 0,92 × CCD × km retorno])
  placa text,
  motorista text,
  ciot text,
  ciot_por text check (ciot_por in ('iplamm', 'transportadora')),
  mdfe_chave text,
  cte_chave text,
  pedagio_valor numeric(12,2),
  pedagio_comprovante text,
  pedagio_nao_ha boolean not null default false,
  lancamento_id uuid references public.lancamentos(id) on delete set null,
  status text not null default 'aberto' check (status in ('aberto', 'cancelado')),
  observacao text,
  criado_por uuid default auth.uid(),
  criado_em timestamptz not null default now(),
  unique (empresa_id, numero)
);
create index if not exists log_fretes_data on public.log_fretes(empresa_id, data);
create index if not exists log_fretes_lanc on public.log_fretes(lancamento_id);
drop trigger if exists log_fretes_numero on public.log_fretes;
create trigger log_fretes_numero before insert on public.log_fretes for each row execute function public._compras_numero();

create table if not exists public.log_frete_anexos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  frete_id uuid references public.log_fretes(id) on delete cascade,
  transportador_id uuid references public.log_transportadores(id) on delete cascade,
  tipo text not null default 'outro' check (tipo in ('contrato', 'ciot', 'mdfe', 'cte', 'vale_pedagio', 'comprovante', 'outro')),
  path text not null unique,
  nome text,
  enviado_por text,
  enviado_em timestamptz not null default now(),
  check (frete_id is not null or transportador_id is not null)
);
create index if not exists log_anx_frete on public.log_frete_anexos(frete_id);
create index if not exists log_anx_transp on public.log_frete_anexos(transportador_id);

do $$ declare t text; begin
  foreach t in array array['log_transportadores', 'log_piso_coef', 'log_fretes', 'log_frete_anexos'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_sel', t);
    execute format('drop policy if exists %I on public.%I', t || '_all', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.ve_logistica(empresa_id))', t || '_sel', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.pode_logistica(empresa_id)) with check (public.pode_logistica(empresa_id))', t || '_all', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('drop trigger if exists zz_auditoria on public.%I', t);
    execute format('create trigger zz_auditoria after insert or update or delete on public.%I for each row execute function public._auditar()', t);
  end loop;
end $$;

-- arquivos: logistica/<empresa>/<frete ou transportador>/<arquivo>; privado (link temporário)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('logistica', 'logistica', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'text/xml', 'application/xml'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists logistica_arq_sel on storage.objects;
drop policy if exists logistica_arq_ins on storage.objects;
drop policy if exists logistica_arq_del on storage.objects;
create policy logistica_arq_sel on storage.objects for select to authenticated using (bucket_id = 'logistica' and public.ve_logistica(public._uuid_ou_nulo((storage.foldername(name))[1])));
create policy logistica_arq_ins on storage.objects for insert to authenticated with check (bucket_id = 'logistica' and public.pode_logistica(public._uuid_ou_nulo((storage.foldername(name))[1])));
create policy logistica_arq_del on storage.objects for delete to authenticated using (bucket_id = 'logistica' and public.pode_logistica(public._uuid_ou_nulo((storage.foldername(name))[1])));

-- Tabela A — carga geral, lotação (Anexo II, com reajuste da Portaria SUROC nº 22/2026, conforme TranspNet).
-- Conferir na calculadora oficial da ANTT; os valores ficam editáveis na tela.
insert into public.log_piso_coef (empresa_id, tabela, tipo_carga, eixos, ccd, cc, vigencia, fonte)
select e.id, 'A', 'geral', v.eixos, v.ccd, v.cc, date '2026-05-24', 'Tabela A carga geral lotação — Portaria SUROC 22/2026 (conferir na ANTT)'
  from public.empresas e,
       (values (2, 4.0738, 451.84), (3, 5.2177, 541.86), (4, 5.9180, 588.86), (5, 6.8284, 657.56), (6, 7.5347, 671.93), (7, 8.2727, 831.66), (9, 9.4114, 903.32)) v(eixos, ccd, cc)
on conflict (empresa_id, tabela, tipo_carga, eixos, vigencia) do nothing;

-- ---------------------------------------------------------------------
-- Pendências de um frete (vazio = conforme). Autônomo: tudo é exigência; transportadora: CIOT, MDF-e e piso viram aviso.
create or replace function public.log_frete_pendencias(p_frete uuid)
returns text[] language plpgsql stable security definer set search_path = public as $$
declare f log_fretes; t log_transportadores; r text[] := '{}'; tac boolean; tem_contrato boolean;
begin
  select * into f from log_fretes where id = p_frete;
  if f.id is null then return array['frete não encontrado']; end if;
  select * into t from log_transportadores where id = f.transportador_id;
  if t.id is null then return array['sem transportador']; end if;
  tac := t.tipo in ('tac', 'tac_eq', 'ctc');
  if coalesce(f.valor, 0) <= 0 then r := array_append(r, 'valor do frete'); end if;
  if nullif(trim(coalesce(f.ciot, '')), '') is null then r := array_append(r, 'CIOT'); end if;
  if nullif(trim(coalesce(f.mdfe_chave, '')), '') is null then r := array_append(r, 'MDF-e'); end if;
  if f.lotacao and f.piso is not null and f.valor is not null and f.valor < f.piso - 0.005 then r := array_append(r, 'abaixo do piso mínimo'); end if;
  if f.lotacao and f.piso is null then r := array_append(r, 'piso não calculado'); end if;
  if not f.pedagio_nao_ha and coalesce(f.pedagio_valor, 0) <= 0 then r := array_append(r, 'vale-pedágio'); end if;
  if tac then
    if nullif(trim(coalesce(t.rntrc, '')), '') is null then r := array_append(r, 'RNTRC'); elsif t.rntrc_validade is not null and t.rntrc_validade < f.data then r := array_append(r, 'RNTRC vencido'); end if;
    select exists(select 1 from log_frete_anexos a where a.transportador_id = t.id and a.tipo = 'contrato') or exists(select 1 from log_frete_anexos a where a.frete_id = f.id and a.tipo = 'contrato') into tem_contrato;
    if not tem_contrato then r := array_append(r, 'contrato'); end if;
    if t.contrato_validade is not null and t.contrato_validade < f.data then r := array_append(r, 'contrato vencido'); end if;
    if nullif(trim(coalesce(t.conta_numero, '') || coalesce(t.conta_pix, '')), '') is null or t.conta_vinculo is null then r := array_append(r, 'conta indicada pelo autônomo'); end if;
  end if;
  return r;
end $$;
revoke execute on function public.log_frete_pendencias(uuid) from anon, public;
grant execute on function public.log_frete_pendencias(uuid) to authenticated;

-- Trava: pagamento de frete com autônomo só com o frete sem pendências (lançamento ligado à ficha do frete).
create or replace function public._log_frete_trava_pagamento() returns trigger
language plpgsql security definer set search_path = public as $$
declare f record; p text[];
begin
  if new.status <> 'Pago' or (tg_op = 'UPDATE' and old.status = 'Pago') then return new; end if;
  for f in select lf.id, lf.numero, t.tipo from log_fretes lf join log_transportadores t on t.id = lf.transportador_id
            where lf.lancamento_id = new.id and lf.status = 'aberto' loop
    if f.tipo in ('tac', 'tac_eq', 'ctc') then
      p := log_frete_pendencias(f.id);
      if cardinality(p) > 0 then
        raise exception 'Frete nº % (autônomo) não pode ser pago: falta %', f.numero, array_to_string(p, ', ');
      end if;
    end if;
  end loop;
  return new;
end $$;
drop trigger if exists log_frete_trava_pagamento on public.lancamentos;
create trigger log_frete_trava_pagamento before insert or update of status on public.lancamentos for each row execute function public._log_frete_trava_pagamento();

-- conferência: 4 tabelas e os coeficientes carregados
select (select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('log_transportadores', 'log_piso_coef', 'log_fretes', 'log_frete_anexos')) as tabelas,
       (select count(*) from public.log_piso_coef) as coeficientes;

-- ===== 20261028000055_frete_dispensas.sql =====
-- =====================================================================
-- Fretes pagos sem ficha: dispensa com justificativa (28/10/2026, Renan: "pode seguir").
-- Tira o lançamento dos alertas de "Conformidade do mês" sem apagar nada: fica registrado o motivo, quem e quando.
-- Motivos: relacao_encerrada (autônomo antigo, sem atividade com a IPLAMM), contratado_terceiro (frete contratado pelo
-- fornecedor/cliente, CT-e em nome da IPLAMM como tomadora), nao_e_frete (despesa lançada no plano de fretes), outro.
-- Migração ADITIVA. Pode rodar mais de uma vez.
-- =====================================================================
create table if not exists public.log_frete_dispensas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  lancamento_id uuid not null unique references public.lancamentos(id) on delete cascade,
  motivo text not null check (motivo in ('relacao_encerrada', 'contratado_terceiro', 'nao_e_frete', 'outro')),
  justificativa text not null,
  criado_por uuid default auth.uid(),
  criado_email text default (auth.jwt() ->> 'email'),
  criado_em timestamptz not null default now()
);
alter table public.log_frete_dispensas enable row level security;
drop policy if exists log_frete_dispensas_sel on public.log_frete_dispensas;
drop policy if exists log_frete_dispensas_all on public.log_frete_dispensas;
create policy log_frete_dispensas_sel on public.log_frete_dispensas for select to authenticated using (public.ve_logistica(empresa_id));
create policy log_frete_dispensas_all on public.log_frete_dispensas for all to authenticated using (public.pode_logistica(empresa_id)) with check (public.pode_logistica(empresa_id));
revoke all on public.log_frete_dispensas from anon;
grant select, insert, update, delete on public.log_frete_dispensas to authenticated;
drop trigger if exists zz_auditoria on public.log_frete_dispensas;
create trigger zz_auditoria after insert or update or delete on public.log_frete_dispensas for each row execute function public._auditar();

select count(*) as tabela_criada from information_schema.tables where table_schema = 'public' and table_name = 'log_frete_dispensas';

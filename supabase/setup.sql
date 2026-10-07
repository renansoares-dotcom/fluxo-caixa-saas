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

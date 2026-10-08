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

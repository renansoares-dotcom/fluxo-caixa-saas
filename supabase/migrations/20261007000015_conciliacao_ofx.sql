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

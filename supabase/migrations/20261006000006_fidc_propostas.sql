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

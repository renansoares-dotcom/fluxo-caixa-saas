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

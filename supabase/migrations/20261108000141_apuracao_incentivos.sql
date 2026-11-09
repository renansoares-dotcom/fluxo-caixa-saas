-- Melhoria 9.2 — Apuração de impostos, etapa 2: PRODEPE (crédito presumido), FEEF, taxa AD/DIPER, FECEP e créditos de PIS/COFINS
-- pelos parâmetros da empresa (com fonte e vigência), apuração do mês com ajustes e fechamento com a memória de cálculo.
-- Nada é suposto: cada percentual, lista de CFOP e de NCM é cadastrado pela empresa na tela (CPD › Fiscal › Apuração de Impostos).
-- Aditivo.

-- ------------------------------------------------------------------ parâmetros por vigência
create table if not exists public.fisc_param (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  vigencia_inicio date not null,
  -- PRODEPE: crédito presumido sobre o ICMS das saídas incentivadas
  prodepe_ativo boolean not null default false,
  prodepe_credito_pct numeric(7,4) not null default 0 check (prodepe_credito_pct between 0 and 100),
  prodepe_base text not null default 'saldo_proporcional' check (prodepe_base in ('saldo_proporcional', 'debito_incentivado')),
  prodepe_cfops text[] not null default '{}',          -- saídas incentivadas (vazio = todas as saídas com ICMS)
  prodepe_ncm text[] not null default '{}',            -- prefixos de NCM incentivados (vazio = todos)
  feef_pct numeric(7,4) not null default 0 check (feef_pct between 0 and 100),
  feef_base text not null default 'beneficio' check (feef_base in ('beneficio', 'saldo_incentivado')),
  ad_diper_pct numeric(7,4) not null default 0 check (ad_diper_pct between 0 and 100),
  -- FECEP: adicional sobre a base do ICMS dos itens listados
  fecep_pct numeric(7,4) not null default 0 check (fecep_pct between 0 and 100),
  fecep_ncm text[] not null default '{}',              -- prefixos de NCM sujeitos (vazio = nenhum)
  fecep_cfops text[] not null default '{}',            -- saídas sujeitas (vazio = todas as saídas)
  -- PIS/COFINS não cumulativo
  pis_pct numeric(7,4) not null default 1.65 check (pis_pct between 0 and 100),
  cofins_pct numeric(7,4) not null default 7.6 check (cofins_pct between 0 and 100),
  pc_cfops_credito text[] not null default '{}',       -- CFOP do fornecedor que dão crédito (vazio = nenhum)
  pc_incluir_frete boolean not null default true,
  pc_incluir_ipi boolean not null default false,       -- IPI não recuperável entra na base do crédito
  pc_excluir_icms boolean not null default true,       -- ICMS fora da base do crédito
  fonte text,
  observacao text,
  atualizado_por uuid default auth.uid(),
  atualizado_em timestamptz not null default now(),
  unique (empresa_id, vigencia_inicio)
);

-- ------------------------------------------------------------------ apuração do mês
create table if not exists public.fisc_apuracoes (
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  mes date not null check (mes = date_trunc('month', mes)::date),
  icms_saldo_credor_ant numeric(14,2) not null default 0,
  icms_outros_debitos numeric(14,2) not null default 0,
  icms_outros_creditos numeric(14,2) not null default 0,
  icms_estorno_debitos numeric(14,2) not null default 0,
  icms_estorno_creditos numeric(14,2) not null default 0,
  ipi_saldo_credor_ant numeric(14,2) not null default 0,
  pc_saldo_credor_ant numeric(14,2) not null default 0,
  pc_outros_creditos numeric(14,2) not null default 0,
  observacao text,
  situacao text not null default 'aberta' check (situacao in ('aberta', 'fechada')),
  resultado jsonb,
  fechada_por uuid,
  fechada_em timestamptz,
  atualizado_em timestamptz not null default now(),
  primary key (empresa_id, mes)
);

-- quem vê: admin, diretor, financeiro; quem grava: admin e financeiro (parâmetros: só admin)
create or replace function public.fisc_pode(p_empresa uuid) returns boolean language sql stable security definer set search_path = public as $$
  select public.papel_em(p_empresa) in ('admin', 'diretor', 'financeiro')
$$;
create or replace function public.fisc_grava(p_empresa uuid) returns boolean language sql stable security definer set search_path = public as $$
  select public.papel_em(p_empresa) in ('admin', 'financeiro')
$$;

alter table public.fisc_param enable row level security;
alter table public.fisc_apuracoes enable row level security;
drop policy if exists fisc_param_sel on public.fisc_param;
create policy fisc_param_sel on public.fisc_param for select to authenticated using (public.fisc_pode(empresa_id));
drop policy if exists fisc_param_ins on public.fisc_param;
create policy fisc_param_ins on public.fisc_param for insert to authenticated with check (public.is_admin(empresa_id));
drop policy if exists fisc_param_upd on public.fisc_param;
create policy fisc_param_upd on public.fisc_param for update to authenticated using (public.is_admin(empresa_id)) with check (public.is_admin(empresa_id));
drop policy if exists fisc_param_del on public.fisc_param;
create policy fisc_param_del on public.fisc_param for delete to authenticated using (public.is_admin(empresa_id));
drop policy if exists fisc_apur_sel on public.fisc_apuracoes;
create policy fisc_apur_sel on public.fisc_apuracoes for select to authenticated using (public.fisc_pode(empresa_id));
drop policy if exists fisc_apur_ins on public.fisc_apuracoes;
create policy fisc_apur_ins on public.fisc_apuracoes for insert to authenticated with check (public.fisc_grava(empresa_id));
drop policy if exists fisc_apur_upd on public.fisc_apuracoes;
create policy fisc_apur_upd on public.fisc_apuracoes for update to authenticated using (public.fisc_grava(empresa_id)) with check (public.fisc_grava(empresa_id));
grant select, insert, update, delete on public.fisc_param to authenticated;
grant select, insert, update on public.fisc_apuracoes to authenticated;

-- normaliza as listas (só dígitos, sem repetidos) e registra quem alterou
create or replace function public._fisc_param_antes() returns trigger language plpgsql as $$
declare f text;
begin
  new.prodepe_cfops := coalesce((select array_agg(distinct x order by x) from unnest(new.prodepe_cfops) u(y), lateral (select regexp_replace(y, '\D', '', 'g') x) z where x <> ''), '{}');
  new.prodepe_ncm   := coalesce((select array_agg(distinct x order by x) from unnest(new.prodepe_ncm) u(y), lateral (select regexp_replace(y, '\D', '', 'g') x) z where x <> ''), '{}');
  new.fecep_ncm     := coalesce((select array_agg(distinct x order by x) from unnest(new.fecep_ncm) u(y), lateral (select regexp_replace(y, '\D', '', 'g') x) z where x <> ''), '{}');
  new.fecep_cfops   := coalesce((select array_agg(distinct x order by x) from unnest(new.fecep_cfops) u(y), lateral (select regexp_replace(y, '\D', '', 'g') x) z where x <> ''), '{}');
  new.pc_cfops_credito := coalesce((select array_agg(distinct x order by x) from unnest(new.pc_cfops_credito) u(y), lateral (select regexp_replace(y, '\D', '', 'g') x) z where x <> ''), '{}');
  if new.prodepe_ativo and new.prodepe_credito_pct <= 0 then raise exception 'Informe o percentual do crédito presumido do PRODEPE'; end if;
  if new.prodepe_ativo and coalesce(btrim(new.fonte), '') = '' then raise exception 'Informe a fonte (decreto, termo de concessão ou orientação da contabilidade)'; end if;
  new.atualizado_por := coalesce(auth.uid(), new.atualizado_por); new.atualizado_em := now();
  return new;
end $$;
drop trigger if exists fisc_param_antes on public.fisc_param;
create trigger fisc_param_antes before insert or update on public.fisc_param for each row execute function public._fisc_param_antes();

-- apuração fechada não muda; reabrir é do administrador (situacao 'fechada' -> 'aberta')
create or replace function public._fisc_apur_antes() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and old.situacao = 'fechada' then
    if new.situacao = 'aberta' and public.is_admin(new.empresa_id) then
      new.resultado := old.resultado; new.fechada_por := null; new.fechada_em := null; new.atualizado_em := now(); return new;
    end if;
    raise exception 'Apuração de % fechada: o administrador precisa reabrir antes de alterar', to_char(old.mes, 'MM/YYYY');
  end if;
  if new.situacao = 'fechada' then
    if new.resultado is null then raise exception 'Fechamento sem a memória de cálculo'; end if;
    new.fechada_por := auth.uid(); new.fechada_em := now();
  end if;
  new.atualizado_em := now();
  return new;
end $$;
drop trigger if exists fisc_apur_antes on public.fisc_apuracoes;
create trigger fisc_apur_antes before insert or update on public.fisc_apuracoes for each row execute function public._fisc_apur_antes();

-- auditoria
drop trigger if exists zz_auditoria on public.fisc_param;
create trigger zz_auditoria after insert or update or delete on public.fisc_param for each row execute function public._auditar();
drop trigger if exists zz_auditoria on public.fisc_apuracoes;
create trigger zz_auditoria after insert or update or delete on public.fisc_apuracoes for each row execute function public._auditar();

comment on table public.fisc_param is 'Parâmetros da apuração (PRODEPE, FEEF, AD/DIPER, FECEP, créditos de PIS/COFINS) por vigência, com fonte (melhoria 9.2)';
comment on table public.fisc_apuracoes is 'Apuração mensal: ajustes, saldos credores e a memória de cálculo do fechamento (melhoria 9.2)';

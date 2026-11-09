-- Melhoria 8.1 — Folha completa: horas extras, férias (programação, períodos aquisitivos e previsão no fluxo), rescisão (simulação,
-- confirmação e previsão das verbas e da multa do FGTS), folha real importada × prevista, e os parâmetros na tela.
-- Os cálculos ficam no navegador (js/lib/rh-calc.js); o banco guarda, protege e lança as previsões (lançamentos "Em aberto"). Aditivo.

alter table public.rh_parametros add column if not exists he_divisor numeric(6,2);
alter table public.rh_parametros add column if not exists he_pct1 numeric(6,2);
alter table public.rh_parametros add column if not exists he_pct2 numeric(6,2);
alter table public.rh_parametros add column if not exists dsr_pct numeric(6,2);
alter table public.rh_parametros add column if not exists ferias_pag_dias_antes smallint;
alter table public.rh_parametros add column if not exists resc_prazo_dias smallint;
alter table public.rh_parametros add column if not exists multa_fgts_pct numeric(6,2);
alter table public.rh_parametros add column if not exists multa_fgts_acordo_pct numeric(6,2);
alter table public.rh_parametros add column if not exists aviso_base smallint;
alter table public.rh_parametros add column if not exists aviso_por_ano smallint;
alter table public.rh_parametros add column if not exists aviso_max smallint;

-- ------------------------------------------------------------------ horas extras por competência
create table if not exists public.rh_horas_extras (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  colaborador_id uuid not null references public.rh_colaboradores(id) on delete cascade,
  competencia date not null check (extract(day from competencia) = 1),
  horas_1 numeric(7,2) not null default 0 check (horas_1 >= 0),     -- adicional 1 (padrão 50%)
  horas_2 numeric(7,2) not null default 0 check (horas_2 >= 0),     -- adicional 2 (padrão 100%)
  valor numeric(12,2) not null default 0 check (valor >= 0),
  observacao text,
  atualizado_em timestamptz not null default now(),
  unique (colaborador_id, competencia)
);

-- ------------------------------------------------------------------ férias
create table if not exists public.rh_ferias (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  colaborador_id uuid not null references public.rh_colaboradores(id) on delete cascade,
  aquisitivo_ini date not null,
  gozo_ini date not null,
  dias smallint not null check (dias between 5 and 30),
  abono_dias smallint not null default 0 check (abono_dias between 0 and 10),
  adiantar_13 boolean not null default false,
  salario numeric(12,2) not null default 0,
  valores jsonb not null default '{}'::jsonb,                        -- ferias, terco, abono, terco_abono, decimo
  total numeric(12,2) not null default 0,
  pagamento date not null,
  situacao text not null default 'programada' check (situacao in ('programada', 'paga', 'cancelada')),
  lancamento_id uuid references public.lancamentos(id) on delete set null,
  observacao text,
  criado_por uuid default auth.uid(), criado_em timestamptz not null default now(),
  check (dias + abono_dias <= 30)
);
create index if not exists rh_ferias_colab on public.rh_ferias(colaborador_id, aquisitivo_ini);

-- ------------------------------------------------------------------ rescisões
create table if not exists public.rh_rescisoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  colaborador_id uuid not null references public.rh_colaboradores(id) on delete cascade,
  data_desligamento date not null,
  motivo text not null check (motivo in ('sem_justa_causa', 'pedido', 'justa_causa', 'acordo', 'termino_contrato')),
  aviso text not null default 'indenizado' check (aviso in ('indenizado', 'trabalhado', 'dispensado')),
  salario numeric(12,2) not null default 0,
  saldo_fgts numeric(14,2) not null default 0,
  ferias_vencidas_dias smallint not null default 0 check (ferias_vencidas_dias between 0 and 60),
  verbas jsonb not null default '[]'::jsonb,
  total numeric(14,2) not null default 0,
  multa_fgts numeric(14,2) not null default 0,
  pagamento date not null,
  situacao text not null default 'simulada' check (situacao in ('simulada', 'confirmada', 'paga', 'cancelada')),
  lancamento_id uuid references public.lancamentos(id) on delete set null,
  lancamento_multa_id uuid references public.lancamentos(id) on delete set null,
  observacao text,
  criado_por uuid default auth.uid(), criado_em timestamptz not null default now()
);
create index if not exists rh_resc_colab on public.rh_rescisoes(colaborador_id);

-- ------------------------------------------------------------------ folha real (importada da folha oficial)
alter table public.rh_folha_itens add column if not exists real jsonb;           -- {proventos, descontos, liquido, inss, fgts, irrf}
alter table public.rh_folhas add column if not exists real_importado_em timestamptz;
alter table public.rh_folhas add column if not exists real_totais jsonb;           -- {liquido, inss, fgts, irrf}

-- RLS igual às demais tabelas do RH (ve_rh / edita_rh) e auditoria
do $$ declare t text; begin
  foreach t in array array['rh_horas_extras', 'rh_ferias', 'rh_rescisoes'] loop
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
    execute format('drop trigger if exists zz_auditoria on public.%I', t);
    execute format('create trigger zz_auditoria after insert or update or delete on public.%I for each row execute function public._auditar()', t);
  end loop;
end $$;

-- colaborador da mesma empresa; férias e rescisões pagas não mudam de valor
create or replace function public._rh_avulso_antes() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (select empresa_id from rh_colaboradores where id = new.colaborador_id) is distinct from new.empresa_id then raise exception 'Colaborador de outra empresa'; end if;
  if tg_op = 'UPDATE' and old.situacao = 'paga' and (new.total is distinct from old.total or new.situacao not in ('paga')) then
    raise exception 'Registro já pago não pode ser alterado';
  end if;
  return new;
end $$;
do $$ declare t text; begin
  foreach t in array array['rh_horas_extras', 'rh_ferias', 'rh_rescisoes'] loop
    execute format('drop trigger if exists rh_avulso_antes on public.%I', t);
  end loop;
end $$;
create trigger rh_avulso_antes before insert or update on public.rh_ferias for each row execute function public._rh_avulso_antes();
create trigger rh_avulso_antes before insert or update on public.rh_rescisoes for each row execute function public._rh_avulso_antes();
create or replace function public._rh_he_antes() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (select empresa_id from rh_colaboradores where id = new.colaborador_id) is distinct from new.empresa_id then raise exception 'Colaborador de outra empresa'; end if;
  new.atualizado_em := now(); return new;
end $$;
create trigger rh_avulso_antes before insert or update on public.rh_horas_extras for each row execute function public._rh_he_antes();

-- ------------------------------------------------------------------ previsão no fluxo (férias e rescisão)
-- cria ou atualiza o lançamento "Em aberto" (plano: planos.ferias/planos.rescisao dos parâmetros, senão planos.salarios; conta: a da folha)
create or replace function public._rh_previsao(p_empresa uuid, p_lanc uuid, p_data date, p_valor numeric, p_plano uuid, p_desc text, p_origem text, p_doc text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_l lancamentos; v_conta uuid;
begin
  select conta_id into v_conta from rh_parametros where empresa_id = p_empresa;
  if p_lanc is not null then select * into v_l from lancamentos where id = p_lanc; end if;
  if v_l.id is not null and v_l.status <> 'Em aberto' then return v_l.id; end if;
  if coalesce(p_valor, 0) <= 0 then
    if v_l.id is not null then delete from lancamentos where id = v_l.id; end if;
    return null;
  end if;
  if p_plano is null then raise exception 'Escolha o plano de contas da previsão nos parâmetros do RH'; end if;
  if v_l.id is not null then
    update lancamentos set data = p_data, valor = p_valor, plano_id = p_plano, descricao = p_desc, conta_id = coalesce(v_conta, conta_id) where id = v_l.id;
    return v_l.id;
  end if;
  insert into lancamentos(empresa_id, data, plano_id, descricao, status, conta_id, valor, origem, documento)
    values (p_empresa, p_data, p_plano, p_desc, 'Em aberto', v_conta, p_valor, p_origem, p_doc) returning id into v_l.id;
  return v_l.id;
end $$;
revoke all on function public._rh_previsao(uuid, uuid, date, numeric, uuid, text, text, text) from public, anon, authenticated;

create or replace function public._rh_plano(p_empresa uuid, p_chave text) returns uuid language sql stable security definer set search_path = public as $$
  select coalesce(nullif(planos ->> p_chave, '')::uuid, nullif(planos ->> 'salarios', '')::uuid) from rh_parametros where empresa_id = p_empresa
$$;

create or replace function public.rh_ferias_lancar(p_id uuid) returns uuid language plpgsql security definer set search_path = public as $$
declare f rh_ferias; v_nome text; v uuid;
begin
  select * into f from rh_ferias where id = p_id;
  if f.id is null then raise exception 'Férias não encontradas'; end if;
  if not public.edita_rh(f.empresa_id) then raise exception 'Sem permissão no RH'; end if;
  select nome into v_nome from rh_colaboradores where id = f.colaborador_id;
  v := public._rh_previsao(f.empresa_id, f.lancamento_id, f.pagamento, case when f.situacao = 'cancelada' then 0 else f.total end, public._rh_plano(f.empresa_id, 'ferias'),
    'RH férias ' || v_nome || ' — saída ' || to_char(f.gozo_ini, 'DD/MM/YYYY') || ' (previsão)', 'rh:ferias:' || f.id, 'RH-FER-' || to_char(f.gozo_ini, 'YYYYMMDD'));
  update rh_ferias set lancamento_id = v where id = p_id;
  return v;
end $$;

create or replace function public.rh_rescisao_lancar(p_id uuid, p_confirmar boolean default true) returns jsonb language plpgsql security definer set search_path = public as $$
declare r rh_rescisoes; v_nome text; v1 uuid; v2 uuid;
begin
  select * into r from rh_rescisoes where id = p_id;
  if r.id is null then raise exception 'Rescisão não encontrada'; end if;
  if not public.edita_rh(r.empresa_id) then raise exception 'Sem permissão no RH'; end if;
  if r.situacao = 'paga' then raise exception 'Rescisão já paga'; end if;
  select nome into v_nome from rh_colaboradores where id = r.colaborador_id;
  v1 := public._rh_previsao(r.empresa_id, r.lancamento_id, r.pagamento, case when r.situacao = 'cancelada' then 0 else r.total end, public._rh_plano(r.empresa_id, 'rescisao'),
    'RH rescisão ' || v_nome || ' (previsão)', 'rh:rescisao:' || r.id, 'RH-RESC-' || to_char(r.data_desligamento, 'YYYYMMDD'));
  v2 := public._rh_previsao(r.empresa_id, r.lancamento_multa_id, r.pagamento, case when r.situacao = 'cancelada' then 0 else r.multa_fgts end, public._rh_plano(r.empresa_id, 'fgts'),
    'RH multa do FGTS (GRRF) ' || v_nome || ' (previsão)', 'rh:rescisao_fgts:' || r.id, 'RH-GRRF-' || to_char(r.data_desligamento, 'YYYYMMDD'));
  update rh_rescisoes set lancamento_id = v1, lancamento_multa_id = v2,
    situacao = case when p_confirmar and situacao = 'simulada' then 'confirmada' else situacao end where id = p_id;
  if p_confirmar and r.situacao in ('simulada', 'confirmada') then
    update rh_colaboradores set situacao = 'desligado', demissao = r.data_desligamento where id = r.colaborador_id;
  end if;
  return jsonb_build_object('lancamento', v1, 'multa', v2);
end $$;

-- cancela: tira as previsões em aberto e, se tinha confirmado, volta o colaborador para ativo
create or replace function public.rh_rescisao_cancelar(p_id uuid) returns void language plpgsql security definer set search_path = public as $$
declare r rh_rescisoes;
begin
  select * into r from rh_rescisoes where id = p_id;
  if r.id is null or not public.edita_rh(r.empresa_id) then raise exception 'Sem permissão no RH'; end if;
  if r.situacao = 'paga' then raise exception 'Rescisão já paga'; end if;
  delete from lancamentos where id in (r.lancamento_id, r.lancamento_multa_id) and status = 'Em aberto';
  update rh_rescisoes set situacao = 'cancelada', lancamento_id = null, lancamento_multa_id = null where id = p_id;
  if r.situacao = 'confirmada' then update rh_colaboradores set situacao = 'ativo', demissao = null where id = r.colaborador_id and demissao = r.data_desligamento; end if;
end $$;

-- folha real: grava o real por item e ajusta os eventos (saldo, INSS, FGTS, IRRF) e as previsões em aberto
-- p_itens: [{item_id, proventos, descontos, liquido, inss, fgts, irrf}]; p_totais: {inss, fgts, irrf} das guias (opcional)
create or replace function public.rh_folha_real(p_folha uuid, p_itens jsonb, p_totais jsonb default null, p_aplicar boolean default true) returns jsonb
language plpgsql security definer set search_path = public as $$
declare f rh_folhas; x jsonb; v_liq numeric; v_adi numeric; v_tot jsonb; e rh_folha_eventos; n int := 0;
begin
  select * into f from rh_folhas where id = p_folha;
  if f.id is null then raise exception 'Folha não encontrada'; end if;
  if not public.edita_rh(f.empresa_id) then raise exception 'Sem permissão no RH'; end if;
  if f.status = 'encerrada' then raise exception 'Folha encerrada'; end if;
  update rh_folha_itens set real = null where folha_id = p_folha;
  for x in select * from jsonb_array_elements(coalesce(p_itens, '[]')) loop
    update rh_folha_itens set real = x - 'item_id' where id = (x ->> 'item_id')::uuid and folha_id = p_folha;
    if found then n := n + 1; end if;
  end loop;
  select coalesce(sum((real ->> 'liquido')::numeric), 0), coalesce(sum(adiantamento) filter (where real is not null), 0) into v_liq, v_adi from rh_folha_itens where folha_id = p_folha;
  v_tot := jsonb_build_object('liquido', v_liq, 'itens', n,
    'inss', coalesce((p_totais ->> 'inss')::numeric, (select sum((real ->> 'inss')::numeric) from rh_folha_itens where folha_id = p_folha)),
    'fgts', coalesce((p_totais ->> 'fgts')::numeric, (select sum((real ->> 'fgts')::numeric) from rh_folha_itens where folha_id = p_folha)),
    'irrf', coalesce((p_totais ->> 'irrf')::numeric, (select sum((real ->> 'irrf')::numeric) from rh_folha_itens where folha_id = p_folha)));
  update rh_folhas set real_importado_em = now(), real_totais = v_tot where id = p_folha;
  if p_aplicar and f.tipo = 'mensal' then
    -- saldo = líquido real − adiantamento já previsto
    update rh_folha_eventos set valor = greatest(0, round(v_liq - v_adi, 2)) where folha_id = p_folha and evento = 'saldo' and v_liq > 0;
    update rh_folha_eventos set valor = round((v_tot ->> 'inss')::numeric, 2) where folha_id = p_folha and evento = 'inss' and (v_tot ->> 'inss') is not null;
    update rh_folha_eventos set valor = round((v_tot ->> 'fgts')::numeric, 2) where folha_id = p_folha and evento = 'fgts' and (v_tot ->> 'fgts') is not null;
    update rh_folha_eventos set valor = round((v_tot ->> 'irrf')::numeric, 2) where folha_id = p_folha and evento = 'irrf' and (v_tot ->> 'irrf') is not null;
    for e in select * from rh_folha_eventos where folha_id = p_folha and lancamento_id is not null loop
      update lancamentos set valor = e.valor where id = e.lancamento_id and status = 'Em aberto' and e.valor > 0;
    end loop;
  end if;
  return v_tot;
end $$;

do $$ declare f text; begin
  foreach f in array array['rh_ferias_lancar(uuid)', 'rh_rescisao_lancar(uuid, boolean)', 'rh_rescisao_cancelar(uuid)', 'rh_folha_real(uuid, jsonb, jsonb, boolean)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  execute 'revoke all on function public._rh_plano(uuid, text) from public, anon, authenticated';
end $$;

comment on table public.rh_ferias is 'Férias programadas com o cálculo e a previsão no fluxo (melhoria 8.1)';
comment on table public.rh_rescisoes is 'Rescisões simuladas e confirmadas, com as verbas, a multa do FGTS e a previsão no fluxo (melhoria 8.1)';

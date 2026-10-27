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

-- Melhoria 9.5 — Centros de custo em níveis (padrão 3: área › departamento › centro, nomes configuráveis) e rateio automático
-- das despesas indiretas (percentual fixo, pessoas, folha ou base informada), em cascata pela ordem das regras.
-- O rateio é gerencial: grava a distribuição em cc_rateio_valores e não altera os lançamentos. Aditivo.

-- ------------------------------------------------------------------ hierarquia
alter table public.centros_custo add column if not exists pai_id uuid references public.centros_custo(id) on delete restrict;
alter table public.centros_custo add column if not exists codigo text;
alter table public.centros_custo add column if not exists nivel smallint not null default 1;
alter table public.centros_custo add column if not exists tipo text check (tipo is null or tipo in ('produtivo', 'apoio', 'administrativo', 'comercial'));
create index if not exists centros_custo_pai on public.centros_custo(pai_id);

create table if not exists public.cc_config (
  empresa_id uuid primary key references public.empresas(id) on delete cascade,
  niveis smallint not null default 3 check (niveis between 1 and 5),
  nomes_niveis text[] not null default array['Área', 'Departamento', 'Centro de custo'],
  so_ultimo_nivel boolean not null default false,         -- lançamento só no último nível (aviso na tela)
  base_valores text not null default 'pago' check (base_valores in ('pago', 'todos')),
  atualizado_em timestamptz not null default now()
);
alter table public.cc_config enable row level security;
drop policy if exists cc_config_sel on public.cc_config;
create policy cc_config_sel on public.cc_config for select to authenticated using (public.is_membro(empresa_id));
drop policy if exists cc_config_ins on public.cc_config;
create policy cc_config_ins on public.cc_config for insert to authenticated with check (public.is_admin(empresa_id));
drop policy if exists cc_config_upd on public.cc_config;
create policy cc_config_upd on public.cc_config for update to authenticated using (public.is_admin(empresa_id)) with check (public.is_admin(empresa_id));
grant select, insert, update on public.cc_config to authenticated;

-- nível pelo pai, sem ciclo, mesma empresa, até o máximo da empresa; filhos acompanham a mudança de nível
create or replace function public._cc_hierarquia() returns trigger language plpgsql security definer set search_path = public as $$
declare v_pai centros_custo; v_max smallint; v_x uuid; v_n int := 0;
begin
  select coalesce((select niveis from cc_config where empresa_id = new.empresa_id), 3) into v_max;
  if new.pai_id is null then new.nivel := 1;
  else
    select * into v_pai from centros_custo where id = new.pai_id;
    if v_pai.empresa_id is distinct from new.empresa_id then raise exception 'O centro superior é de outra empresa'; end if;
    v_x := new.pai_id;
    while v_x is not null loop
      if v_x = new.id then raise exception 'Um centro não pode ficar abaixo dele mesmo'; end if;
      select pai_id into v_x from centros_custo where id = v_x; v_n := v_n + 1; exit when v_n > 10;
    end loop;
    new.nivel := v_pai.nivel + 1;
  end if;
  if new.nivel > v_max then raise exception 'A empresa usa até % nível(is) de centro de custo', v_max; end if;
  new.codigo := nullif(btrim(new.codigo), '');
  return new;
end $$;
drop trigger if exists cc_hierarquia on public.centros_custo;
create trigger cc_hierarquia before insert or update of pai_id, empresa_id on public.centros_custo for each row execute function public._cc_hierarquia();

create or replace function public._cc_filhos_nivel() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.nivel is distinct from old.nivel then update centros_custo set pai_id = pai_id where pai_id = new.id; end if;
  return null;
end $$;
drop trigger if exists cc_filhos_nivel on public.centros_custo;
create trigger cc_filhos_nivel after update of nivel on public.centros_custo for each row execute function public._cc_filhos_nivel();

-- descendentes (inclui o próprio)
create or replace function public.cc_subarvore(p_cc uuid) returns setof uuid language sql stable set search_path = public as $$
  with recursive t(id) as (select p_cc union all select c.id from centros_custo c join t on c.pai_id = t.id) select id from t
$$;

-- ------------------------------------------------------------------ rateio
create table if not exists public.cc_rateio_regras (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  nome text not null,
  ativo boolean not null default true,
  ordem int not null default 10,
  origem_cc_id uuid not null references public.centros_custo(id) on delete cascade,
  planos uuid[] not null default '{}',                    -- contas do plano rateadas (vazio = todas as saídas)
  criterio text not null check (criterio in ('percentual', 'pessoas', 'folha', 'base')),
  base_nome text,                                         -- ex.: m², kg produzidos, horas-máquina
  observacao text,
  atualizado_em timestamptz not null default now()
);
create table if not exists public.cc_rateio_destinos (
  regra_id uuid not null references public.cc_rateio_regras(id) on delete cascade,
  cc_id uuid not null references public.centros_custo(id) on delete cascade,
  percentual numeric(7,4) check (percentual is null or percentual between 0 and 100),
  base numeric(16,4) check (base is null or base >= 0),
  primary key (regra_id, cc_id)
);
create table if not exists public.cc_rateio_meses (
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  mes date not null check (mes = date_trunc('month', mes)::date),
  situacao text not null default 'aplicado' check (situacao in ('aplicado', 'fechado')),
  aplicado_por uuid default auth.uid(), aplicado_em timestamptz not null default now(),
  primary key (empresa_id, mes)
);
create table if not exists public.cc_rateio_valores (
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  mes date not null,
  regra_id uuid not null references public.cc_rateio_regras(id) on delete cascade,
  origem_cc_id uuid not null references public.centros_custo(id) on delete cascade,
  destino_cc_id uuid not null references public.centros_custo(id) on delete cascade,
  peso numeric(18,6) not null,
  valor numeric(16,2) not null,
  primary key (empresa_id, mes, regra_id, destino_cc_id)
);

create or replace function public.cc_pode(p_empresa uuid) returns boolean language sql stable security definer set search_path = public as $$
  select public.papel_em(p_empresa) in ('admin', 'diretor', 'financeiro')
$$;
alter table public.cc_rateio_regras enable row level security;
alter table public.cc_rateio_destinos enable row level security;
alter table public.cc_rateio_meses enable row level security;
alter table public.cc_rateio_valores enable row level security;
drop policy if exists ccr_regras_sel on public.cc_rateio_regras;
create policy ccr_regras_sel on public.cc_rateio_regras for select to authenticated using (public.cc_pode(empresa_id));
do $$ declare a text; begin
  foreach a in array array['insert', 'update', 'delete'] loop
    execute format('drop policy if exists ccr_regras_%1$s on public.cc_rateio_regras', a);
    execute format('create policy ccr_regras_%1$s on public.cc_rateio_regras for %1$s to authenticated %2$s', a,
      case a when 'insert' then 'with check (public.is_admin(empresa_id))' when 'update' then 'using (public.is_admin(empresa_id)) with check (public.is_admin(empresa_id))' else 'using (public.is_admin(empresa_id))' end);
    execute format('drop policy if exists ccr_dest_%1$s on public.cc_rateio_destinos', a);
    execute format('create policy ccr_dest_%1$s on public.cc_rateio_destinos for %1$s to authenticated %2$s', a,
      case a when 'insert' then 'with check (exists (select 1 from cc_rateio_regras r where r.id = regra_id and public.is_admin(r.empresa_id)))'
             when 'update' then 'using (exists (select 1 from cc_rateio_regras r where r.id = regra_id and public.is_admin(r.empresa_id))) with check (exists (select 1 from cc_rateio_regras r where r.id = regra_id and public.is_admin(r.empresa_id)))'
             else 'using (exists (select 1 from cc_rateio_regras r where r.id = regra_id and public.is_admin(r.empresa_id)))' end);
  end loop;
end $$;
drop policy if exists ccr_dest_sel on public.cc_rateio_destinos;
create policy ccr_dest_sel on public.cc_rateio_destinos for select to authenticated using (exists (select 1 from cc_rateio_regras r where r.id = regra_id and public.cc_pode(r.empresa_id)));
drop policy if exists ccr_meses_sel on public.cc_rateio_meses;
create policy ccr_meses_sel on public.cc_rateio_meses for select to authenticated using (public.cc_pode(empresa_id));
drop policy if exists ccr_rat_sel on public.cc_rateio_valores;
create policy ccr_rat_sel on public.cc_rateio_valores for select to authenticated using (public.cc_pode(empresa_id));
grant select, insert, update, delete on public.cc_rateio_regras, public.cc_rateio_destinos to authenticated;
grant select on public.cc_rateio_meses, public.cc_rateio_valores to authenticated;
drop trigger if exists zz_auditoria on public.cc_rateio_regras;
create trigger zz_auditoria after insert or update or delete on public.cc_rateio_regras for each row execute function public._auditar();

create or replace function public._ccr_mesma_empresa() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'cc_rateio_regras' then
    if (select empresa_id from centros_custo where id = new.origem_cc_id) is distinct from new.empresa_id then raise exception 'Centro de origem de outra empresa'; end if;
  else
    if (select empresa_id from centros_custo where id = new.cc_id) is distinct from (select empresa_id from cc_rateio_regras where id = new.regra_id) then raise exception 'Centro de destino de outra empresa'; end if;
    if new.cc_id = (select origem_cc_id from cc_rateio_regras where id = new.regra_id) then raise exception 'O destino não pode ser o próprio centro de origem'; end if;
  end if;
  return new;
end $$;
drop trigger if exists ccr_mesma_empresa on public.cc_rateio_regras;
create trigger ccr_mesma_empresa before insert or update on public.cc_rateio_regras for each row execute function public._ccr_mesma_empresa();
drop trigger if exists ccr_mesma_empresa on public.cc_rateio_destinos;
create trigger ccr_mesma_empresa before insert or update on public.cc_rateio_destinos for each row execute function public._ccr_mesma_empresa();

-- cálculo do mês em cascata: cada regra rateia o direto da origem (subárvore) + o que a origem recebeu das regras anteriores
create or replace function public.cc_rateio_calcular(p_empresa uuid, p_mes date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_ini date := date_trunc('month', p_mes)::date; v_fim date := (date_trunc('month', p_mes) + interval '1 month - 1 day')::date;
  v_base text; r cc_rateio_regras; v_direto numeric; v_recebido numeric; v_total numeric; v_soma numeric; v_resto numeric;
  recebe jsonb := '{}'; v_out jsonb := '[]'; v_dest jsonb; v_pesos jsonb; d record; v_aviso text; v_maior uuid;
begin
  if not public.cc_pode(p_empresa) then raise exception 'Sem acesso ao rateio de custos'; end if;
  select coalesce((select base_valores from cc_config where empresa_id = p_empresa), 'pago') into v_base;
  for r in select * from cc_rateio_regras where empresa_id = p_empresa and ativo order by ordem, nome loop
    select coalesce(sum(l.valor), 0) into v_direto from lancamentos l join plano_contas p on p.id = l.plano_id
     where l.empresa_id = p_empresa and l.data between v_ini and v_fim and p.tipo = 'S' and (v_base = 'todos' or l.status = 'Pago')
       and l.centro_custo_id in (select public.cc_subarvore(r.origem_cc_id))
       and (cardinality(r.planos) = 0 or l.plano_id = any(r.planos) or p.pai_id = any(r.planos));
    select coalesce(sum(value::numeric), 0) into v_recebido from jsonb_each_text(recebe) where key::uuid in (select public.cc_subarvore(r.origem_cc_id));
    v_total := round(v_direto + v_recebido, 2); v_aviso := null; v_dest := '[]';
    -- pesos de cada destino
    select coalesce(jsonb_agg(jsonb_build_object('cc', cc_id, 'peso', peso) order by peso desc, cc_id), '[]'), coalesce(sum(peso), 0) into v_pesos, v_soma from (
      select dd.cc_id, (case r.criterio
          when 'percentual' then coalesce(dd.percentual, 0)
          when 'base' then coalesce(dd.base, 0)
          when 'pessoas' then (select count(*) from rh_colaboradores c where c.empresa_id = p_empresa and c.situacao <> 'desligado' and c.centro_custo_id in (select public.cc_subarvore(dd.cc_id))
                                 and coalesce(c.admissao, v_ini) <= v_fim and (c.demissao is null or c.demissao > v_fim))
          else (select coalesce(sum(c.salario), 0) from rh_colaboradores c where c.empresa_id = p_empresa and c.situacao <> 'desligado' and c.centro_custo_id in (select public.cc_subarvore(dd.cc_id))
                                 and coalesce(c.admissao, v_ini) <= v_fim and (c.demissao is null or c.demissao > v_fim)) end)::numeric peso
        from cc_rateio_destinos dd where dd.regra_id = r.id) z;
    if v_soma <= 0 then v_aviso := 'Sem base para ratear (pesos zerados)';
    elsif r.criterio = 'percentual' and abs(v_soma - 100) > 0.01 then v_aviso := format('Os percentuais somam %s%%, não 100%%', trim(to_char(v_soma, 'FM9990D00')));
    end if;
    if v_aviso is null and v_total <> 0 then
      v_resto := v_total;
      for d in select (x ->> 'cc')::uuid cc, (x ->> 'peso')::numeric peso, round(v_total * (x ->> 'peso')::numeric / v_soma, 2) val from jsonb_array_elements(v_pesos) x loop
        v_maior := coalesce(v_maior, d.cc); v_resto := v_resto - d.val;
        v_dest := v_dest || jsonb_build_object('cc_id', d.cc, 'peso', d.peso, 'valor', d.val);
      end loop;
      -- centavos de arredondamento no maior peso
      if v_resto <> 0 then
        v_dest := (select jsonb_agg(case when x ->> 'cc_id' = v_maior::text then x || jsonb_build_object('valor', (x ->> 'valor')::numeric + v_resto) else x end) from jsonb_array_elements(v_dest) x);
      end if;
      for d in select (x ->> 'cc_id') cc, (x ->> 'valor')::numeric val from jsonb_array_elements(v_dest) x loop
        recebe := recebe || jsonb_build_object(d.cc, coalesce((recebe ->> d.cc)::numeric, 0) + d.val);
      end loop;
      -- o que saiu da origem deixa de contar como recebido por ela
      for d in select key, value::numeric val from jsonb_each_text(recebe) where key::uuid in (select public.cc_subarvore(r.origem_cc_id)) loop
        recebe := recebe - d.key;
      end loop;
    else
      select coalesce(jsonb_agg(jsonb_build_object('cc_id', x ->> 'cc', 'peso', (x ->> 'peso')::numeric, 'valor', 0)), '[]') into v_dest from jsonb_array_elements(v_pesos) x;
    end if;
    v_maior := null;
    v_out := v_out || jsonb_build_object('regra_id', r.id, 'nome', r.nome, 'criterio', r.criterio, 'base_nome', r.base_nome, 'origem_cc_id', r.origem_cc_id,
      'direto', round(v_direto, 2), 'recebido', round(v_recebido, 2), 'total', v_total, 'aviso', v_aviso, 'soma_pesos', v_soma, 'destinos', v_dest);
  end loop;
  return v_out;
end $$;

-- aplicar: grava a distribuição do mês (substitui); mês fechado não muda
create or replace function public.cc_rateio_aplicar(p_empresa uuid, p_mes date) returns int
language plpgsql security definer set search_path = public as $$
declare v_ini date := date_trunc('month', p_mes)::date; C jsonb; x jsonb; d jsonb; n int := 0;
begin
  if not public.papel_em(p_empresa) in ('admin', 'financeiro') then raise exception 'Só o administrador e o financeiro aplicam o rateio'; end if;
  if exists (select 1 from cc_rateio_meses where empresa_id = p_empresa and mes = v_ini and situacao = 'fechado') then raise exception 'Rateio de % fechado', to_char(v_ini, 'MM/YYYY'); end if;
  C := public.cc_rateio_calcular(p_empresa, v_ini);
  delete from cc_rateio_valores where empresa_id = p_empresa and mes = v_ini;
  for x in select * from jsonb_array_elements(C) loop
    if x ->> 'aviso' is not null then continue; end if;
    for d in select * from jsonb_array_elements(x -> 'destinos') loop
      if (d ->> 'valor')::numeric = 0 then continue; end if;
      insert into cc_rateio_valores(empresa_id, mes, regra_id, origem_cc_id, destino_cc_id, peso, valor)
        values (p_empresa, v_ini, (x ->> 'regra_id')::uuid, (x ->> 'origem_cc_id')::uuid, (d ->> 'cc_id')::uuid, (d ->> 'peso')::numeric, (d ->> 'valor')::numeric);
      n := n + 1;
    end loop;
  end loop;
  insert into cc_rateio_meses(empresa_id, mes) values (p_empresa, v_ini)
    on conflict (empresa_id, mes) do update set aplicado_por = auth.uid(), aplicado_em = now();
  return n;
end $$;

create or replace function public.cc_rateio_situacao(p_empresa uuid, p_mes date, p_fechar boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_fechar and not public.papel_em(p_empresa) in ('admin', 'financeiro') then raise exception 'Sem permissão'; end if;
  if not p_fechar and not public.is_admin(p_empresa) then raise exception 'Só o administrador reabre o rateio'; end if;
  update cc_rateio_meses set situacao = case when p_fechar then 'fechado' else 'aplicado' end where empresa_id = p_empresa and mes = date_trunc('month', p_mes)::date;
  if not found then raise exception 'Aplique o rateio do mês antes de fechar'; end if;
end $$;

-- resultado por centro (valores diretos e rateados do período); a árvore e os totais por nível são montados na tela
create or replace function public.cc_resultado(p_empresa uuid, p_ini date, p_fim date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_base text; v jsonb;
begin
  if not public.cc_pode(p_empresa) then raise exception 'Sem acesso ao resultado por centro'; end if;
  select coalesce((select base_valores from cc_config where empresa_id = p_empresa), 'pago') into v_base;
  with dir as (
    select l.centro_custo_id cc, sum(case when p.tipo = 'E' then l.valor else 0 end) receitas, sum(case when p.tipo = 'S' then l.valor else 0 end) despesas
      from lancamentos l join plano_contas p on p.id = l.plano_id
     where l.empresa_id = p_empresa and l.data between p_ini and p_fim and p.tipo in ('E', 'S') and (v_base = 'todos' or l.status = 'Pago')
     group by l.centro_custo_id
  ), rec as (select destino_cc_id cc, sum(valor) v from cc_rateio_valores where empresa_id = p_empresa and mes between date_trunc('month', p_ini) and p_fim group by 1),
     env as (select origem_cc_id cc, sum(valor) v from cc_rateio_valores where empresa_id = p_empresa and mes between date_trunc('month', p_ini) and p_fim group by 1),
  todos as (select cc from dir union select cc from rec union select cc from env)
  select jsonb_build_object('base', v_base,
    'meses_aplicados', (select coalesce(jsonb_agg(jsonb_build_object('mes', mes, 'situacao', situacao) order by mes), '[]') from cc_rateio_meses where empresa_id = p_empresa and mes between date_trunc('month', p_ini) and p_fim),
    'linhas', coalesce(jsonb_agg(jsonb_build_object('cc_id', t.cc, 'receitas', round(coalesce(d.receitas, 0), 2), 'despesas', round(coalesce(d.despesas, 0), 2),
      'rateio_recebido', round(coalesce(r.v, 0), 2), 'rateio_enviado', round(coalesce(e.v, 0), 2))), '[]'))
    into v from todos t left join dir d on d.cc is not distinct from t.cc left join rec r on r.cc = t.cc left join env e on e.cc = t.cc;
  return v;
end $$;

do $$ declare f text; begin
  foreach f in array array['cc_rateio_calcular(uuid, date)', 'cc_rateio_aplicar(uuid, date)', 'cc_rateio_situacao(uuid, date, boolean)', 'cc_resultado(uuid, date, date)', 'cc_subarvore(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

comment on table public.cc_rateio_regras is 'Rateio gerencial das despesas indiretas entre centros de custo, em cascata pela ordem (melhoria 9.5)';

-- =====================================================================
-- Melhoria contínua 3.1 — Regras de classificação, edição em lote, divisão por centro de custo e lançamentos recorrentes
-- (07/11/2026). Migração ADITIVA: só cria tabelas e funções; não altera lançamentos existentes.
--  • lanc_regras: "se o texto contém POSTO, então 2.06.02 COMBUSTÍVEL" (com centro de custo, favorecido e modelo de rateio);
--    aplicadas no lançamento novo, no "Criar lançamento" da conciliação e em lote nos Lançamentos.
--  • cc_rateios: modelos de rateio por centro de custo (ex.: energia 60/30/10), usados na divisão do lançamento.
--  • lanc_dividir: divide um lançamento em vários (um por centro de custo); recusa o conciliado.
--  • lanc_editar_lote: muda plano, centro de custo, favorecido e conta de vários lançamentos (os conciliados ficam de fora).
--  • lanc_recorrentes: despesas e receitas fixas (aluguel, assinaturas, honorários) que viram títulos EM ABERTO com N meses de
--    antecedência; geração diária pelo agendamento (pg_cron), pelo botão "Gerar agora" e ao salvar.
-- =====================================================================

-- 1) modelos de rateio
create table if not exists public.cc_rateios (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  nome text not null,
  partes jsonb not null default '[]'::jsonb,                 -- [{"centro_custo_id": uuid, "pct": 60}, …] somando 100
  ativo boolean not null default true,
  atualizado_em timestamptz not null default now(),
  unique (empresa_id, nome)
);
create or replace function public._cc_rateio_check() returns trigger language plpgsql set search_path = public as $$
declare s numeric; n int; ruins int;
begin
  select coalesce(sum((p ->> 'pct')::numeric), 0), count(*) into s, n from jsonb_array_elements(new.partes) p;
  if n < 2 then raise exception 'O rateio precisa de pelo menos dois centros de custo.'; end if;
  if round(s, 2) <> 100 then raise exception 'Os percentuais do rateio somam % e precisam somar 100.', round(s, 2); end if;
  select count(*) into ruins from jsonb_array_elements(new.partes) p
   where not exists (select 1 from centros_custo c where c.id = (p ->> 'centro_custo_id')::uuid and c.empresa_id = new.empresa_id) or (p ->> 'pct')::numeric <= 0;
  if ruins > 0 then raise exception 'Centro de custo inválido ou percentual zerado no rateio.'; end if;
  new.atualizado_em := now(); return new;
end $$;
drop trigger if exists cc_rateio_check on public.cc_rateios;
create trigger cc_rateio_check before insert or update on public.cc_rateios for each row execute function public._cc_rateio_check();

-- 2) regras de classificação
create table if not exists public.lanc_regras (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  nome text,
  campo text not null default 'texto' check (campo in ('texto', 'descricao', 'favorecido', 'documento')),   -- texto = descrição + favorecido + documento
  operador text not null default 'contem' check (operador in ('contem', 'comeca', 'igual', 'regex')),
  texto text not null check (length(trim(texto)) > 0),
  natureza text check (natureza in ('E', 'S')),               -- só entradas ou só saídas (nulo = as duas)
  valor_min numeric(16,2), valor_max numeric(16,2),
  conta_id uuid references public.contas(id) on delete cascade,   -- só nesta conta (nulo = qualquer)
  plano_id uuid not null references public.plano_contas(id) on delete cascade,
  centro_custo_id uuid references public.centros_custo(id) on delete set null,
  favorecido_id uuid references public.favorecidos(id) on delete set null,
  rateio_id uuid references public.cc_rateios(id) on delete set null,
  prioridade int not null default 100,                        -- menor = testada primeiro
  ativo boolean not null default true,
  origem text not null default 'manual' check (origem in ('manual', 'sugerida')),
  usos int not null default 0, ultimo_uso timestamptz,
  criado_por text default (auth.jwt() ->> 'email'), criado_em timestamptz not null default now(),
  check (valor_min is null or valor_max is null or valor_min <= valor_max)
);
create index if not exists lanc_regras_emp on public.lanc_regras(empresa_id, ativo, prioridade);
create or replace function public._lanc_regra_check() returns trigger language plpgsql set search_path = public as $$
begin
  if not exists (select 1 from plano_contas where id = new.plano_id and empresa_id = new.empresa_id) then raise exception 'Plano de contas de outra empresa.'; end if;
  if new.operador = 'regex' then begin perform 'x' ~* new.texto; exception when others then raise exception 'Expressão regular inválida: %', new.texto; end; end if;
  return new;
end $$;
drop trigger if exists lanc_regra_check on public.lanc_regras;
create trigger lanc_regra_check before insert or update on public.lanc_regras for each row execute function public._lanc_regra_check();

-- 3) recorrentes
create table if not exists public.lanc_recorrentes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  descricao text not null,
  plano_id uuid not null references public.plano_contas(id),
  favorecido_id uuid references public.favorecidos(id) on delete set null,
  centro_custo_id uuid references public.centros_custo(id) on delete set null,
  conta_id uuid references public.contas(id) on delete set null,
  valor numeric(16,2) not null check (valor > 0),
  frequencia text not null default 'mensal' check (frequencia in ('mensal', 'bimestral', 'trimestral', 'semestral', 'anual')),
  dia int not null default 10 check (dia between 1 and 31),             -- dia do vencimento (31 = último dia do mês)
  inicio date not null,                                                  -- primeira competência
  fim date,                                                              -- última (nulo = sem fim)
  ajuste_fds text not null default 'postergar' check (ajuste_fds in ('manter', 'antecipar', 'postergar')),
  meses_a_frente int not null default 3 check (meses_a_frente between 0 and 24),
  prioridade text check (prioridade in ('Obrigatório', 'Negociável')),
  documento text, observacao text,
  ativo boolean not null default true,
  criado_por text default (auth.jwt() ->> 'email'), criado_em timestamptz not null default now(), atualizado_em timestamptz not null default now(),
  check (fim is null or fim >= inicio)
);
create index if not exists lanc_recorrentes_emp on public.lanc_recorrentes(empresa_id, ativo);
alter table public.lancamentos add column if not exists recorrente_id uuid references public.lanc_recorrentes(id) on delete set null;
create index if not exists lancamentos_recorrente on public.lancamentos(recorrente_id) where recorrente_id is not null;

-- RLS: leitura para membro; gravação para quem edita
do $$ declare t text;
begin
  foreach t in array array['cc_rateios', 'lanc_regras', 'lanc_recorrentes'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_sel', t); execute format('drop policy if exists %I on public.%I', t || '_ins', t);
    execute format('drop policy if exists %I on public.%I', t || '_upd', t); execute format('drop policy if exists %I on public.%I', t || '_del', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_membro(empresa_id))', t || '_sel', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.pode_editar(empresa_id))', t || '_ins', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.pode_editar(empresa_id)) with check (public.pode_editar(empresa_id))', t || '_upd', t);
    execute format('create policy %I on public.%I for delete to authenticated using (public.pode_editar(empresa_id))', t || '_del', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- 4) datas de vencimento de um recorrente até uma data (competência mensal → dia, último dia do mês, fim de semana)
create or replace function public._recorrente_vencimentos(r lanc_recorrentes, p_ate date)
returns table(competencia date, vencimento date) language plpgsql immutable as $$
declare passo int := case r.frequencia when 'mensal' then 1 when 'bimestral' then 2 when 'trimestral' then 3 when 'semestral' then 6 else 12 end;
        c date := date_trunc('month', r.inicio)::date; v date; k int := 0;
begin
  while c <= p_ate and (r.fim is null or c <= date_trunc('month', r.fim)) and k < 400 loop
    v := c + (least(r.dia, extract(day from (c + interval '1 month - 1 day'))::int) - 1);
    if extract(isodow from v) in (6, 7) then
      if r.ajuste_fds = 'postergar' then v := v + (8 - extract(isodow from v)::int);
      elsif r.ajuste_fds = 'antecipar' then v := v - (extract(isodow from v)::int - 5); end if;
    end if;
    if v >= r.inicio then competencia := c; vencimento := v; return next; end if;   -- o vencimento pode passar do limite pelo ajuste do fim de semana
    c := (c + make_interval(months => passo))::date; k := k + 1;
  end loop;
end $$;

/** gera os títulos em aberto que faltam (um por competência, sem duplicar) até "hoje + meses à frente" de cada recorrente */
create or replace function public._recorrentes_gerar(p_empresa uuid, p_id uuid default null)
returns int language plpgsql security definer set search_path = public as $$
declare r lanc_recorrentes; x record; n int := 0;
begin
  for r in select * from lanc_recorrentes where empresa_id = p_empresa and ativo and (p_id is null or id = p_id) loop
    for x in select * from _recorrente_vencimentos(r, (date_trunc('month', current_date) + make_interval(months => r.meses_a_frente + 1) - interval '1 day')::date) loop
      continue when exists (select 1 from lancamentos where recorrente_id = r.id and origem = 'recorrente:' || r.id || ':' || to_char(x.competencia, 'YYYY-MM'));
      continue when x.vencimento < current_date - 31;          -- não cria passado antigo ao cadastrar com início lá atrás
      insert into lancamentos(empresa_id, data, plano_id, descricao, favorecido_id, centro_custo_id, status, conta_id, valor, prioridade, documento, origem, recorrente_id)
      values (r.empresa_id, x.vencimento, r.plano_id, left(r.descricao || ' — ' || to_char(x.competencia, 'MM/YYYY'), 300), r.favorecido_id, r.centro_custo_id, 'Em aberto', r.conta_id,
              r.valor, r.prioridade, r.documento, 'recorrente:' || r.id || ':' || to_char(x.competencia, 'YYYY-MM'), r.id);
      n := n + 1;
    end loop;
  end loop;
  return n;
end $$;
revoke all on function public._recorrentes_gerar(uuid, uuid) from public, anon, authenticated;

create or replace function public.lanc_recorrentes_gerar(p_empresa uuid, p_id uuid default null)
returns int language plpgsql security definer set search_path = public as $$
begin
  if not pode_editar(p_empresa) then raise exception 'Sem permissão.'; end if;
  return _recorrentes_gerar(p_empresa, p_id);
end $$;
revoke all on function public.lanc_recorrentes_gerar(uuid, uuid) from public, anon;
grant execute on function public.lanc_recorrentes_gerar(uuid, uuid) to authenticated;

/** depois de mudar o recorrente: atualiza os títulos dele ainda EM ABERTO de hoje em diante (valor, plano, favorecido, centro, conta) */
create or replace function public.lanc_recorrente_atualizar_futuros(p_id uuid)
returns int language plpgsql security definer set search_path = public as $$
declare r lanc_recorrentes; n int;
begin
  select * into r from lanc_recorrentes where id = p_id;
  if r.id is null or not pode_editar(r.empresa_id) then raise exception 'Sem permissão.'; end if;
  update lancamentos set valor = r.valor, plano_id = r.plano_id, favorecido_id = r.favorecido_id, centro_custo_id = r.centro_custo_id, conta_id = r.conta_id, prioridade = r.prioridade
   where recorrente_id = r.id and status = 'Em aberto' and data >= current_date
     and not exists (select 1 from conciliacoes c where c.lancamento_id = lancamentos.id);
  get diagnostics n = row_count;
  -- fim ou desativado: apaga os em aberto que passaram do fim
  delete from lancamentos where recorrente_id = r.id and status = 'Em aberto' and data >= current_date
     and (not r.ativo or (r.fim is not null and date_trunc('month', data) > date_trunc('month', r.fim)))
     and not exists (select 1 from conciliacoes c where c.lancamento_id = lancamentos.id);
  return n;
end $$;
revoke all on function public.lanc_recorrente_atualizar_futuros(uuid) from public, anon;
grant execute on function public.lanc_recorrente_atualizar_futuros(uuid) to authenticated;

-- resumo para a tela: próximo vencimento, títulos em aberto, último pago
create or replace function public.lanc_recorrentes_lista(p_empresa uuid)
returns table(id uuid, abertos bigint, abertos_valor numeric, proximo date, ultimo_pago date, pagos_12m numeric)
language sql stable security definer set search_path = public as $$
  select r.id, count(l.id) filter (where l.status = 'Em aberto'), coalesce(sum(l.valor) filter (where l.status = 'Em aberto'), 0),
         min(l.data) filter (where l.status = 'Em aberto' and l.data >= current_date), max(l.data) filter (where l.status = 'Pago'),
         coalesce(sum(l.valor) filter (where l.status = 'Pago' and l.data >= current_date - 365), 0)
    from lanc_recorrentes r left join lancamentos l on l.recorrente_id = r.id
   where r.empresa_id = p_empresa and is_membro(p_empresa) group by r.id;
$$;
revoke all on function public.lanc_recorrentes_lista(uuid) from public, anon;
grant execute on function public.lanc_recorrentes_lista(uuid) to authenticated;

-- 5) dividir um lançamento por centro de custo: [{"centro_custo_id": uuid, "valor": 123.45}, …] somando o valor original
create or replace function public.lanc_dividir(p_id uuid, p_partes jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare l lancamentos; s numeric; n int; p jsonb; k int := 0; tot int;
begin
  select * into l from lancamentos where id = p_id for update;
  if l.id is null or not pode_editar(l.empresa_id) then raise exception 'Sem permissão.'; end if;
  if exists (select 1 from conciliacoes where lancamento_id = l.id) then raise exception 'Lançamento conciliado: desfaça a conciliação, divida e concilie de novo (em grupo).'; end if;
  if l.conta_destino_id is not null then raise exception 'Transferência não se divide por centro de custo.'; end if;
  select coalesce(sum((x ->> 'valor')::numeric), 0), count(*) into s, n from jsonb_array_elements(p_partes) x;
  if n < 2 then raise exception 'Informe pelo menos duas partes.'; end if;
  if round(s, 2) <> l.valor then raise exception 'As partes somam %, e o lançamento é de %.', round(s, 2), l.valor; end if;
  if exists (select 1 from jsonb_array_elements(p_partes) x where (x ->> 'valor')::numeric <= 0
             or not exists (select 1 from centros_custo c where c.id = (x ->> 'centro_custo_id')::uuid and c.empresa_id = l.empresa_id)) then
    raise exception 'Cada parte precisa de um centro de custo desta empresa e valor maior que zero.'; end if;
  tot := n;
  for p in select * from jsonb_array_elements(p_partes) loop
    k := k + 1;
    if k = 1 then
      update lancamentos set valor = (p ->> 'valor')::numeric, centro_custo_id = (p ->> 'centro_custo_id')::uuid,
             descricao = left(coalesce(l.descricao, '') || ' (rateio 1/' || tot || ')', 500) where id = l.id;
    else
      insert into lancamentos(empresa_id, data, plano_id, descricao, opc1, opc2, opc3, opc4, favorecido_id, centro_custo_id, status, conta_id, valor, prioridade, origem,
                              documento, emissao, fidc_proposta_id, contrato_id, recorrente_id)
      values (l.empresa_id, l.data, l.plano_id, left(coalesce(l.descricao, '') || ' (rateio ' || k || '/' || tot || ')', 500), l.opc1, l.opc2, l.opc3, l.opc4, l.favorecido_id,
              (p ->> 'centro_custo_id')::uuid, l.status, l.conta_id, (p ->> 'valor')::numeric, l.prioridade, 'divisao:' || l.id, l.documento, l.emissao, l.fidc_proposta_id, l.contrato_id, l.recorrente_id);
    end if;
  end loop;
  return tot;
end $$;
revoke all on function public.lanc_dividir(uuid, jsonb) from public, anon;
grant execute on function public.lanc_dividir(uuid, jsonb) to authenticated;

-- 6) edição em lote: só plano, centro de custo, favorecido e conta; conciliados ficam de fora; transferência não muda de plano
create or replace function public.lanc_editar_lote(p_ids uuid[], p_campos jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_emp uuid; n int := 0; pulados int := 0; v_plano uuid := nullif(p_campos ->> 'plano_id', '')::uuid;
begin
  select distinct empresa_id into v_emp from lancamentos where id = any(p_ids);
  if v_emp is null or (select count(distinct empresa_id) from lancamentos where id = any(p_ids)) > 1 or not pode_editar(v_emp) then raise exception 'Sem permissão.'; end if;
  if v_plano is not null and not exists (select 1 from plano_contas where id = v_plano and empresa_id = v_emp and tipo in ('E', 'S')) then raise exception 'Escolha um plano de entrada ou saída desta empresa.'; end if;
  select count(*) into pulados from lancamentos l where l.id = any(p_ids) and (exists (select 1 from conciliacoes c where c.lancamento_id = l.id) or l.conta_destino_id is not null);
  update lancamentos l set
      plano_id = coalesce(v_plano, l.plano_id),
      centro_custo_id = case when p_campos ? 'centro_custo_id' then nullif(p_campos ->> 'centro_custo_id', '')::uuid else l.centro_custo_id end,
      favorecido_id = case when p_campos ? 'favorecido_id' then nullif(p_campos ->> 'favorecido_id', '')::uuid else l.favorecido_id end,
      conta_id = case when p_campos ? 'conta_id' then nullif(p_campos ->> 'conta_id', '')::uuid else l.conta_id end
   where l.id = any(p_ids) and not exists (select 1 from conciliacoes c where c.lancamento_id = l.id) and l.conta_destino_id is null
     -- entrada fica entrada e saída fica saída
     and (v_plano is null or (select tipo from plano_contas where id = v_plano) = (select tipo from plano_contas where id = l.plano_id));
  get diagnostics n = row_count;
  return jsonb_build_object('alterados', n, 'pulados', cardinality(p_ids) - n, 'conciliados', pulados);
end $$;
revoke all on function public.lanc_editar_lote(uuid[], jsonb) from public, anon;
grant execute on function public.lanc_editar_lote(uuid[], jsonb) to authenticated;

-- 7) geração diária automática dos recorrentes (se o projeto tiver pg_cron)
create or replace function public._recorrentes_gerar_todas() returns int language plpgsql security definer set search_path = public as $$
declare e uuid; n int := 0;
begin for e in select distinct empresa_id from lanc_recorrentes where ativo loop n := n + _recorrentes_gerar(e, null); end loop; return n; end $$;
revoke all on function public._recorrentes_gerar_todas() from public, anon, authenticated;
do $$
begin
  begin create extension if not exists pg_cron; exception when others then raise notice 'pg_cron indisponível: os recorrentes são gerados pela tela (%).', sqlerrm; return; end;
  perform cron.unschedule(jobid) from cron.job where jobname = 'recorrentes-gerar';
  perform cron.schedule('recorrentes-gerar', '17 9 * * *', $job$ select public._recorrentes_gerar_todas(); $job$);   -- todo dia às 6h17 de Brasília
exception when others then raise notice 'agendamento não criado: %', sqlerrm;
end $$;

-- conferência: tabelas = 3, funções = 7
select (select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('cc_rateios', 'lanc_regras', 'lanc_recorrentes')) as tabelas,
       (select count(*) from pg_proc where proname in ('lanc_recorrentes_gerar', 'lanc_recorrente_atualizar_futuros', 'lanc_recorrentes_lista', 'lanc_dividir', 'lanc_editar_lote', '_recorrente_vencimentos', '_recorrentes_gerar')) as funcoes;

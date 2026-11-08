-- =====================================================================
-- Melhoria contínua 6.5 — Preventiva por horas reais e peças críticas (08/11/2026)
--   • horas de máquina = última leitura do horímetro + horas apontadas na produção DEPOIS da leitura
--     (antes, uma leitura antiga congelava as horas); sem leitura, a soma dos apontamentos, como antes;
--   • a preventiva por horas é gerada quando passa de X% do intervalo (antes fixo em 90%; agora parâmetro);
--   • man_preventivas_horas: por plano, horas desde a última execução, ritmo médio de horas/dia e a data prevista;
--   • peças críticas (man_pecas_criticas): mínimo e ponto de pedido por peça (e máquina), com saldo do estoque,
--     consumo dos últimos 12 meses nas OS e o que os planos vão pedir nos próximos dias;
--   • aviso diário "Peça crítica abaixo do mínimo" (no máximo um por peça a cada N dias).
-- Migração ADITIVA (as funções man_horas_maquina e man_gerar_preventivas são recriadas com a mesma assinatura).
-- =====================================================================
alter table public.man_parametros add column if not exists gerar_horas_pct numeric(5,2) not null default 90 check (gerar_horas_pct between 50 and 100);
alter table public.man_parametros add column if not exists dias_ritmo smallint not null default 30 check (dias_ritmo between 7 and 180);
alter table public.man_parametros add column if not exists horizonte_pecas_dias smallint not null default 30 check (horizonte_pecas_dias between 7 and 180);
alter table public.man_parametros add column if not exists avisar_pecas boolean not null default true;
alter table public.man_parametros add column if not exists avisar_pecas_dias smallint not null default 7 check (avisar_pecas_dias between 1 and 60);

create table if not exists public.man_pecas_criticas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  produto_id uuid not null references public.produtos(id) on delete cascade,
  equipamento_id uuid references public.man_equipamentos(id) on delete set null,   -- vazio: peça comum a várias máquinas
  minimo numeric(14,3) not null check (minimo > 0),
  ponto_pedido numeric(14,3) check (ponto_pedido is null or ponto_pedido >= minimo),
  observacao text check (length(observacao) <= 500),
  ativo boolean not null default true,
  avisado_em date,
  criado_em timestamptz not null default now()
);
create unique index if not exists man_pecas_criticas_uq on public.man_pecas_criticas(empresa_id, produto_id, coalesce(equipamento_id, '00000000-0000-0000-0000-000000000000'::uuid));
alter table public.man_pecas_criticas enable row level security;
drop policy if exists man_pecas_criticas_sel on public.man_pecas_criticas;
drop policy if exists man_pecas_criticas_ins on public.man_pecas_criticas;
drop policy if exists man_pecas_criticas_upd on public.man_pecas_criticas;
drop policy if exists man_pecas_criticas_del on public.man_pecas_criticas;
create policy man_pecas_criticas_sel on public.man_pecas_criticas for select to authenticated using (public.is_participante(empresa_id));
create policy man_pecas_criticas_ins on public.man_pecas_criticas for insert to authenticated with check (public.pode_manutencao(empresa_id));
create policy man_pecas_criticas_upd on public.man_pecas_criticas for update to authenticated using (public.pode_manutencao(empresa_id)) with check (public.pode_manutencao(empresa_id));
create policy man_pecas_criticas_del on public.man_pecas_criticas for delete to authenticated using (public.pode_manutencao(empresa_id));
grant select, insert, update, delete on public.man_pecas_criticas to authenticated;
drop trigger if exists zz_auditoria on public.man_pecas_criticas;
create trigger zz_auditoria after insert or update or delete on public.man_pecas_criticas for each row execute function public._auditar();

insert into public.notif_tipos(codigo, grupo, nome, descricao, urgente, ordem)
values ('man_peca', 'Produção', 'Peça crítica abaixo do mínimo', 'Saldo de uma peça crítica da manutenção abaixo do mínimo cadastrado.', false, 40)
on conflict (codigo) do nothing;

-- horas de máquina: horímetro + apontamentos depois da leitura; sem leitura, só os apontamentos
create or replace function public.man_horas_maquina(p_equipamento uuid, p_ate timestamptz default now())
returns numeric language sql stable security definer set search_path = public as $$
  with e as (select * from man_equipamentos where id = p_equipamento),
  ap as (
    select coalesce(sum(extract(epoch from (least(coalesce(a.fim, p_ate), p_ate) - greatest(a.inicio,
             coalesce((select (horimetro_em + 1)::timestamp at time zone 'America/Recife' from e where horimetro is not null), '-infinity'::timestamptz))))) / 3600.0, 0) h
      from prod_apontamentos a, e
     where e.maquina_id is not null and a.maquina_id = e.maquina_id and a.inicio < p_ate
       and coalesce(a.fim, p_ate) > coalesce((select (horimetro_em + 1)::timestamp at time zone 'America/Recife' from e where horimetro is not null), '-infinity'::timestamptz)
  )
  select round(coalesce((select horimetro from e), 0) + greatest((select h from ap), 0), 1);
$$;
revoke all on function public.man_horas_maquina(uuid, timestamptz) from public, anon;
grant execute on function public.man_horas_maquina(uuid, timestamptz) to authenticated;

-- preventivas: o percentual do intervalo de horas que já gera a OS vem dos parâmetros
create or replace function public.man_gerar_preventivas(p_empresa uuid, p_ate date default null)
returns int language plpgsql security definer set search_path = public as $$
declare pr man_parametros; p record; v_n int := 0; v_vence date; v_h numeric; v_lim date;
begin
  if not public.pode_manutencao(p_empresa) then raise exception 'Sem permissão.'; end if;
  select * into pr from man_parametros where empresa_id = p_empresa;
  v_lim := coalesce(p_ate, current_date + coalesce(pr.antecedencia_dias, 7));
  for p in select pl.*, e.situacao eq_sit, e.criticidade from man_planos pl join man_equipamentos e on e.id = pl.equipamento_id
            where pl.empresa_id = p_empresa and pl.ativo and e.situacao <> 'inativo'
              and not exists (select 1 from man_ordens o where o.plano_id = pl.id and o.situacao not in ('concluida', 'cancelada')) loop
    v_vence := null;
    if p.a_cada_dias is not null then v_vence := coalesce(p.ultima_data, current_date) + p.a_cada_dias; end if;
    if p.a_cada_horas is not null then
      v_h := man_horas_maquina(p.equipamento_id) - coalesce(p.ultima_horas, 0);
      if v_h >= p.a_cada_horas * coalesce(pr.gerar_horas_pct, 90) / 100 then v_vence := least(coalesce(v_vence, current_date), current_date); end if;
    end if;
    if p.ultima_data is null and p.a_cada_dias is not null and p.a_cada_horas is null then v_vence := current_date; end if;
    continue when v_vence is null or v_vence > v_lim;
    insert into man_ordens(empresa_id, equipamento_id, tipo, origem, plano_id, prioridade, situacao, descricao, programada_para, vence_em, maquina_parou, checklist, solicitante)
    values (p_empresa, p.equipamento_id, p.tipo, 'plano', p.id, case when p.criticidade = 'A' then 'alta' else 'media' end, 'programada', p.nome,
            greatest(current_date, v_vence - 1), v_vence, p.exige_parada,
            coalesce((select jsonb_agg(jsonb_build_object('item', x, 'ok', null)) from unnest(p.checklist) x), '[]'::jsonb), 'plano preventivo');
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke all on function public.man_gerar_preventivas(uuid, date) from public, anon;
grant execute on function public.man_gerar_preventivas(uuid, date) to authenticated;

-- planos por horas: horas desde a última execução, ritmo de horas/dia (apontamentos dos últimos N dias) e a data prevista
create or replace function public.man_preventivas_horas(p_empresa uuid)
returns table(plano_id uuid, plano text, equipamento_id uuid, equipamento text, criticidade char(1), a_cada_horas numeric, horas_atuais numeric,
              ultima_horas numeric, desde_ultima numeric, pct numeric, ritmo_h_dia numeric, dias_restantes numeric, previsao date, fonte text, os_aberta int)
language plpgsql stable security definer set search_path = public as $$
declare v_dias int; v_pct numeric;
begin
  if not public.is_participante(p_empresa) then raise exception 'Sem permissão.'; end if;
  select coalesce(dias_ritmo, 30), coalesce(gerar_horas_pct, 90) into v_dias, v_pct from man_parametros where empresa_id = p_empresa;
  v_dias := coalesce(v_dias, 30);
  return query
  with pl as (
    select p.*, e.codigo || ' ' || e.nome eq_nome, e.criticidade crit, e.maquina_id, e.horimetro, man_horas_maquina(e.id) h_atual
      from man_planos p join man_equipamentos e on e.id = p.equipamento_id
     where p.empresa_id = p_empresa and p.ativo and p.a_cada_horas is not null and e.situacao <> 'inativo'
  ), rit as (
    select pl.id, coalesce((select sum(extract(epoch from (least(coalesce(a.fim, now()), now()) - greatest(a.inicio, now() - make_interval(days => v_dias))))) / 3600.0
                              from prod_apontamentos a where a.maquina_id = pl.maquina_id and coalesce(a.fim, now()) > now() - make_interval(days => v_dias)), 0) / v_dias r
      from pl
  )
  select pl.id, pl.nome, pl.equipamento_id, pl.eq_nome, pl.crit, pl.a_cada_horas, pl.h_atual, pl.ultima_horas,
         round(pl.h_atual - coalesce(pl.ultima_horas, 0), 1),
         round((pl.h_atual - coalesce(pl.ultima_horas, 0)) / pl.a_cada_horas * 100, 1),
         round(rit.r, 2),
         case when rit.r > 0 then round(greatest(pl.a_cada_horas - (pl.h_atual - coalesce(pl.ultima_horas, 0)), 0) / rit.r, 1) end,
         case when rit.r > 0 then (current_date + ceil(greatest(pl.a_cada_horas - (pl.h_atual - coalesce(pl.ultima_horas, 0)), 0) / rit.r)::int) end,
         case when pl.horimetro is not null then 'horímetro + apontamentos' when pl.maquina_id is not null then 'apontamentos' else 'sem fonte de horas' end,
         (select count(*)::int from man_ordens o where o.plano_id = pl.id and o.situacao not in ('concluida', 'cancelada'))
    from pl join rit on rit.id = pl.id
   order by 10 desc;
end $$;
revoke all on function public.man_preventivas_horas(uuid) from public, anon;
grant execute on function public.man_preventivas_horas(uuid) to authenticated;

-- peças críticas: saldo, mínimo, consumo e o que os planos vão pedir no horizonte
create or replace function public.man_pecas_situacao(p_empresa uuid)
returns table(id uuid, produto_id uuid, codigo text, descricao text, unidade text, equipamento text, minimo numeric, ponto_pedido numeric,
              saldo numeric, consumo_12m numeric, previsto_planos numeric, situacao text, ultimo_preco numeric, observacao text)
language plpgsql stable security definer set search_path = public as $$
declare v_h int; v_impl date;
begin
  if not public.is_participante(p_empresa) then raise exception 'Sem permissão.'; end if;
  select coalesce(horizonte_pecas_dias, 30) into v_h from man_parametros where empresa_id = p_empresa;
  v_h := coalesce(v_h, 30);
  select implantado_em into v_impl from est_config where empresa_id = p_empresa;
  return query
  with pc as (
    select c.*, p.codigo, p.descricao, p.unidade, e.codigo || ' ' || e.nome eq
      from man_pecas_criticas c join produtos p on p.id = c.produto_id left join man_equipamentos e on e.id = c.equipamento_id
     where c.empresa_id = p_empresa and c.ativo
  ), prev as (
    -- planos que vencem no horizonte (por dias ou pela previsão de horas) × peças previstas
    select (x->>'produto_id')::uuid produto_id, sum((x->>'quantidade')::numeric) q
      from man_planos pl cross join lateral jsonb_array_elements(pl.pecas) x
     where pl.empresa_id = p_empresa and pl.ativo
       and ((pl.a_cada_dias is not null and coalesce(pl.ultima_data, current_date) + pl.a_cada_dias <= current_date + v_h)
         or pl.id in (select h.plano_id from public.man_preventivas_horas(p_empresa) h where h.previsao <= current_date + v_h or h.pct >= 100))
     group by 1
  )
  select pc.id, pc.produto_id, pc.codigo, pc.descricao, pc.unidade, pc.eq, pc.minimo, pc.ponto_pedido,
         case when v_impl is not null then (select coalesce(sum(s.quantidade), 0) from est_saldos s where s.produto_id = pc.produto_id) end,
         (select coalesce(sum(op.quantidade), 0) from man_os_pecas op where op.produto_id = pc.produto_id and op.situacao = 'consumida' and op.criado_em > now() - interval '12 months'),
         coalesce((select q from prev where prev.produto_id = pc.produto_id), 0),
         case when v_impl is null then 'sem_estoque'
              when (select coalesce(sum(s.quantidade), 0) from est_saldos s where s.produto_id = pc.produto_id) < pc.minimo then 'abaixo'
              when (select coalesce(sum(s.quantidade), 0) from est_saldos s where s.produto_id = pc.produto_id) <= coalesce(pc.ponto_pedido, pc.minimo)
                or (select coalesce(sum(s.quantidade), 0) from est_saldos s where s.produto_id = pc.produto_id) - coalesce((select q from prev where prev.produto_id = pc.produto_id), 0) < pc.minimo then 'comprar'
              else 'ok' end,
         (select pf.ultimo_preco from produto_fornecedores pf where pf.produto_id = pc.produto_id and pf.ultimo_preco is not null order by pf.ultima_compra desc nulls last limit 1),
         pc.observacao
    from pc order by 12, 4;
end $$;
revoke all on function public.man_pecas_situacao(uuid) from public, anon;
grant execute on function public.man_pecas_situacao(uuid) to authenticated;

-- aviso diário: peças abaixo do mínimo (no máximo um aviso por peça a cada N dias)
create or replace function public._man_pecas_avisos() returns int language plpgsql security definer set search_path = public as $$
declare r record; v_n int := 0; v_users uuid[];
begin
  for r in select c.id, c.empresa_id, p.codigo, p.descricao, c.minimo, coalesce(pr.avisar_pecas_dias, 7) dias,
                  (select coalesce(sum(s.quantidade), 0) from est_saldos s where s.produto_id = c.produto_id) saldo
             from man_pecas_criticas c join produtos p on p.id = c.produto_id
             join est_config ec on ec.empresa_id = c.empresa_id and ec.implantado_em is not null
             left join man_parametros pr on pr.empresa_id = c.empresa_id
            where c.ativo and coalesce(pr.avisar_pecas, true)
              and (c.avisado_em is null or c.avisado_em <= current_date - coalesce(pr.avisar_pecas_dias, 7)) loop
    continue when r.saldo >= r.minimo;
    v_users := _usuarios_papel(r.empresa_id, array['admin', 'diretor', 'compras', 'producao']);
    perform _notificar_u(r.empresa_id, v_users, 'man_peca', 'Peça crítica abaixo do mínimo: ' || r.codigo,
      r.descricao || ' — saldo ' || trim(to_char(r.saldo, 'FM999G999G990D###')) || ', mínimo ' || trim(to_char(r.minimo, 'FM999G999G990D###')) || '.',
      '#/manutencao/preventivas', r.id, false);
    update man_pecas_criticas set avisado_em = current_date where id = r.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke all on function public._man_pecas_avisos() from public, anon, authenticated;

do $$
begin
  begin create extension if not exists pg_cron; exception when others then raise notice 'pg_cron indisponível (%).', sqlerrm; return; end;
  perform cron.unschedule(jobid) from cron.job where jobname = 'manutencao-pecas';
  perform cron.schedule('manutencao-pecas', '37 10 * * *', $job$ select public._man_pecas_avisos(); $job$);   -- 07:37 em Brasília
exception when others then raise notice 'agendamento não criado: %', sqlerrm;
end $$;

-- conferência: 1 tabela, 3 funções novas e 5 parâmetros
select (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'man_pecas_criticas') as tabela,
       (select count(*) from pg_proc where proname in ('man_preventivas_horas', 'man_pecas_situacao', '_man_pecas_avisos')) as funcoes,
       (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'man_parametros'
          and column_name in ('gerar_horas_pct', 'dias_ritmo', 'horizonte_pecas_dias', 'avisar_pecas', 'avisar_pecas_dias')) as parametros;

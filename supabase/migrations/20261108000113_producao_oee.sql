-- =====================================================================
-- Melhoria contínua 6.1 — OEE por máquina (08/11/2026)
-- Disponibilidade × desempenho × qualidade, juntando os apontamentos, as paradas da produção, as paradas de máquina
-- registradas nas OS da manutenção e o refugo. Série por dia, semana ou mês para a tendência; perdas em horas.
--   prod_oee_config: metas (OEE, disponibilidade, desempenho, qualidade), meta por máquina e se as OS de manutenção
--                    com "máquina parou" contam como parada não planejada (as já ligadas a uma parada não contam duas vezes).
--   prod_oee(empresa, de, ate, grupo): números por máquina e período; o cálculo dos índices fica na tela (js/lib/oee-calc.js).
-- Migração ADITIVA.
-- =====================================================================
create table if not exists public.prod_oee_config (
  empresa_id uuid primary key references public.empresas(id) on delete cascade,
  meta_oee numeric(5,2) not null default 65 check (meta_oee between 1 and 100),
  meta_disp numeric(5,2) not null default 85 check (meta_disp between 1 and 100),
  meta_perf numeric(5,2) not null default 85 check (meta_perf between 1 and 100),
  meta_qual numeric(5,2) not null default 95 check (meta_qual between 1 and 100),
  atencao_pp numeric(5,2) not null default 10 check (atencao_pp between 0 and 50),   -- até X pontos abaixo da meta = atenção
  metas_maquina jsonb not null default '{}'::jsonb check (jsonb_typeof(metas_maquina) = 'object'),   -- { maquina_id: meta_oee }
  contar_os_manutencao boolean not null default true,
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid default auth.uid()
);
alter table public.prod_oee_config enable row level security;
drop policy if exists prod_oee_config_sel on public.prod_oee_config;
drop policy if exists prod_oee_config_ins on public.prod_oee_config;
drop policy if exists prod_oee_config_upd on public.prod_oee_config;
create policy prod_oee_config_sel on public.prod_oee_config for select to authenticated using (public.is_participante(empresa_id));
create policy prod_oee_config_ins on public.prod_oee_config for insert to authenticated with check (public.pode_editar(empresa_id));
create policy prod_oee_config_upd on public.prod_oee_config for update to authenticated using (public.pode_editar(empresa_id)) with check (public.pode_editar(empresa_id));
grant select, insert, update on public.prod_oee_config to authenticated;
drop trigger if exists zz_auditoria on public.prod_oee_config;
create trigger zz_auditoria after insert or update or delete on public.prod_oee_config for each row execute function public._auditar();

-- horas de um intervalo dentro de [de, ate+1) — o que passa das bordas do período é cortado
create or replace function public._oee_horas(p_ini timestamptz, p_fim timestamptz, p_de timestamptz, p_ate timestamptz)
returns numeric language sql immutable as $$
  select greatest(0, extract(epoch from (least(coalesce(p_fim, now()), p_ate) - greatest(p_ini, p_de))) / 3600)::numeric
$$;

create or replace function public.prod_oee(p_empresa uuid, p_de date, p_ate date, p_grupo text default 'dia')
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_cfg record; v_tz text := 'America/Recife'; v_out jsonb;
  v_de timestamptz := (p_de::timestamp at time zone 'America/Recife');
  v_ate timestamptz := ((p_ate + 1)::timestamp at time zone 'America/Recife');
begin
  if not public.is_participante(p_empresa) then raise exception 'Sem permissão.'; end if;
  if p_grupo not in ('dia', 'semana', 'mes') then raise exception 'Agrupamento inválido.'; end if;
  if p_ate < p_de or p_ate - p_de > 400 then raise exception 'Período inválido (até 400 dias).'; end if;
  select * into v_cfg from prod_oee_config where empresa_id = p_empresa;
  with dias as (
    select d::date dia from generate_series(p_de, p_ate, interval '1 day') d
  ), per as (
    select dia, case p_grupo when 'dia' then dia when 'semana' then date_trunc('week', dia)::date else date_trunc('month', dia)::date end per from dias
  ), maq as (
    select m.id, m.setor_id, coalesce(s.horas_dia, 24) horas_dia, m.capacidade_kg_h
      from prod_maquinas m left join prod_setores s on s.id = m.setor_id
     where m.empresa_id = p_empresa and m.ativo
  ), cal as (
    select maq.id maquina_id, per.per, sum(maq.horas_dia) horas_cal, count(*) dias
      from maq cross join per group by 1, 2
  ), ap as (
    select a.maquina_id, (select per from per where dia = (a.inicio at time zone v_tz)::date) per,
           sum(public._oee_horas(a.inicio, a.fim, v_de, v_ate)) horas_run, sum(a.qtd_boa) bom, sum(a.refugo) refugo, count(*) apont
      from prod_apontamentos a
     where a.empresa_id = p_empresa and a.maquina_id is not null and a.inicio >= v_de and a.inicio < v_ate
     group by 1, 2
  ), pa as (
    select p.maquina_id, (select per from per where dia = (p.inicio at time zone v_tz)::date) per,
           sum(case when coalesce(mo.planejada, false) then public._oee_horas(p.inicio, p.fim, v_de, v_ate) else 0 end) h_plan,
           sum(case when not coalesce(mo.planejada, false) then public._oee_horas(p.inicio, p.fim, v_de, v_ate) else 0 end) h_nao_plan
      from prod_paradas p left join prod_motivos mo on mo.id = p.motivo_id
     where p.empresa_id = p_empresa and p.inicio >= v_de and p.inicio < v_ate
     group by 1, 2
  ), os as (
    select e.maquina_id, (select per from per where dia = (o.parada_inicio at time zone v_tz)::date) per,
           sum(public._oee_horas(o.parada_inicio, o.parada_fim, v_de, v_ate)) h_os, count(*) qtd_os
      from man_ordens o join man_equipamentos e on e.id = o.equipamento_id
     where o.empresa_id = p_empresa and coalesce(v_cfg.contar_os_manutencao, true) and o.maquina_parou and o.parada_id is null
       and o.parada_inicio is not null and o.parada_inicio >= v_de and o.parada_inicio < v_ate and o.situacao <> 'cancelada' and e.maquina_id is not null
     group by 1, 2
  ), lin as (
    select c.maquina_id, c.per, c.horas_cal, c.dias,
           coalesce(ap.horas_run, 0) horas_run, coalesce(ap.bom, 0) bom, coalesce(ap.refugo, 0) refugo, coalesce(ap.apont, 0) apont,
           coalesce(pa.h_plan, 0) h_plan, coalesce(pa.h_nao_plan, 0) h_nao_plan, coalesce(os.h_os, 0) h_os, coalesce(os.qtd_os, 0) qtd_os
      from cal c left join ap on ap.maquina_id = c.maquina_id and ap.per = c.per
      left join pa on pa.maquina_id = c.maquina_id and pa.per = c.per
      left join os on os.maquina_id = c.maquina_id and os.per = c.per
  )
  select jsonb_build_object(
    'de', p_de, 'ate', p_ate, 'grupo', p_grupo,
    'linhas', (select coalesce(jsonb_agg(jsonb_build_object('maquina_id', maquina_id, 'per', per, 'horas_cal', round(horas_cal, 2), 'dias', dias,
                 'horas_run', round(horas_run, 3), 'bom', bom, 'refugo', refugo, 'apont', apont, 'h_plan', round(h_plan, 3),
                 'h_nao_plan', round(h_nao_plan, 3), 'h_os', round(h_os, 3), 'qtd_os', qtd_os) order by per, maquina_id), '[]'::jsonb) from lin),
    'paradas', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select p.maquina_id, coalesce(mo.nome, 'Sem motivo') motivo, coalesce(mo.planejada, false) planejada, count(*) qtd,
               round(sum(public._oee_horas(p.inicio, p.fim, v_de, v_ate)), 3) horas
          from prod_paradas p left join prod_motivos mo on mo.id = p.motivo_id
         where p.empresa_id = p_empresa and p.inicio >= v_de and p.inicio < v_ate group by 1, 2, 3
        union all
        select e.maquina_id, 'Manutenção (OS ' || o.tipo || ')', false, count(*), round(sum(public._oee_horas(o.parada_inicio, o.parada_fim, v_de, v_ate)), 3)
          from man_ordens o join man_equipamentos e on e.id = o.equipamento_id
         where o.empresa_id = p_empresa and coalesce(v_cfg.contar_os_manutencao, true) and o.maquina_parou and o.parada_id is null
           and o.parada_inicio >= v_de and o.parada_inicio < v_ate and o.situacao <> 'cancelada' and e.maquina_id is not null group by 1, 2) x),
    'refugos', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select a.maquina_id, coalesce(mo.nome, 'Sem motivo') motivo, round(sum(a.refugo), 3) kg
          from prod_apontamentos a left join prod_motivos mo on mo.id = a.refugo_motivo_id
         where a.empresa_id = p_empresa and a.inicio >= v_de and a.inicio < v_ate and a.refugo > 0 group by 1, 2) x)
  ) into v_out;
  return v_out;
end $$;
revoke all on function public.prod_oee(uuid, date, date, text) from public, anon;
grant execute on function public.prod_oee(uuid, date, date, text) to authenticated;

-- conferência: 1 tabela e 1 função
select (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'prod_oee_config') as tabela,
       (select count(*) from pg_proc where proname = 'prod_oee') as funcao;

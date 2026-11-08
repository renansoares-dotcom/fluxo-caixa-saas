-- =====================================================================
-- Melhoria contínua 6.8 — Planta da fábrica ao vivo (08/11/2026)
--   • tempo real: apontamentos, paradas e OS de manutenção entram na publicação do Supabase Realtime, e a planta se
--     atualiza na hora em que o operador aponta (além da atualização periódica);
--   • situação "Em manutenção" (OS aberta que parou a máquina), parada longa e ritmo da produção em curso (na tela);
--   • aviso "Máquina parada há muito tempo": parada não planejada aberta há mais de N minutos (um aviso por parada);
--   • prod_planta_config: intervalo da atualização, limite da parada longa, aviso e tempo real.
-- Migração ADITIVA.
-- =====================================================================
create table if not exists public.prod_planta_config (
  empresa_id uuid primary key references public.empresas(id) on delete cascade,
  atualizar_seg smallint not null default 30 check (atualizar_seg between 10 and 300),
  parada_longa_min smallint not null default 20 check (parada_longa_min between 5 and 480),
  avisar_parada boolean not null default true,
  avisar_papeis text[] not null default array['admin', 'diretor'],
  tempo_real boolean not null default true,
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid default auth.uid()
);
alter table public.prod_planta_config enable row level security;
drop policy if exists prod_planta_config_sel on public.prod_planta_config;
drop policy if exists prod_planta_config_ins on public.prod_planta_config;
drop policy if exists prod_planta_config_upd on public.prod_planta_config;
create policy prod_planta_config_sel on public.prod_planta_config for select to authenticated using (public.is_participante(empresa_id));
create policy prod_planta_config_ins on public.prod_planta_config for insert to authenticated with check (public.pode_pcp(empresa_id));
create policy prod_planta_config_upd on public.prod_planta_config for update to authenticated using (public.pode_pcp(empresa_id)) with check (public.pode_pcp(empresa_id));
grant select, insert, update on public.prod_planta_config to authenticated;
drop trigger if exists zz_auditoria on public.prod_planta_config;
create trigger zz_auditoria after insert or update or delete on public.prod_planta_config for each row execute function public._auditar();

alter table public.prod_paradas add column if not exists avisada_em timestamptz;

insert into public.notif_tipos(codigo, grupo, nome, descricao, urgente, ordem)
values ('parada_longa', 'Produção', 'Máquina parada há muito tempo', 'Parada não planejada aberta há mais tempo que o limite da Planta da Fábrica.', false, 41)
on conflict (codigo) do nothing;

-- aviso de parada longa: a cada 5 minutos, um aviso por parada
create or replace function public._planta_avisos() returns int language plpgsql security definer set search_path = public as $$
declare r record; v_n int := 0;
begin
  for r in select p.id, p.empresa_id, p.inicio, m.codigo, m.nome, coalesce(mo.nome, 'sem motivo') motivo, coalesce(c.parada_longa_min, 20) lim, coalesce(c.avisar_papeis, array['admin', 'diretor']) papeis
             from prod_paradas p join prod_maquinas m on m.id = p.maquina_id left join prod_motivos mo on mo.id = p.motivo_id
             left join prod_planta_config c on c.empresa_id = p.empresa_id
            where p.fim is null and p.avisada_em is null and not coalesce(mo.planejada, false) and coalesce(c.avisar_parada, true)
              and p.inicio < now() - make_interval(mins => coalesce(c.parada_longa_min, 20)) loop
    perform _notificar_u(r.empresa_id, _usuarios_papel(r.empresa_id, r.papeis), 'parada_longa',
      r.codigo || ' parada há ' || (extract(epoch from now() - r.inicio) / 60)::int || ' min',
      r.nome || ' — ' || r.motivo || '.', '#/producao/planta', r.id, false);
    update prod_paradas set avisada_em = now() where id = r.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke all on function public._planta_avisos() from public, anon, authenticated;

do $$
begin
  begin create extension if not exists pg_cron; exception when others then raise notice 'pg_cron indisponível (%).', sqlerrm; return; end;
  perform cron.unschedule(jobid) from cron.job where jobname = 'planta-paradas-longas';
  perform cron.schedule('planta-paradas-longas', '*/5 * * * *', $job$ select public._planta_avisos(); $job$);
exception when others then raise notice 'agendamento não criado: %', sqlerrm;
end $$;

-- tempo real (a política de leitura de cada tabela continua valendo para quem recebe)
do $$ declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['prod_apontamentos', 'prod_paradas', 'man_ordens'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

-- conferência: 1 tabela, 1 coluna nova e 1 função
select (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'prod_planta_config') as tabela,
       (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'prod_paradas' and column_name = 'avisada_em') as coluna,
       (select count(*) from pg_proc where proname = '_planta_avisos') as funcao;

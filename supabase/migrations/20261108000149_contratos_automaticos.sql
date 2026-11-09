-- Melhoria 10.4 — Contratos automáticos:
--  - índices (IPCA, IGP-M, INPC) baixados todo dia da API pública do Banco Central (SGS) pelo próprio banco (pg_net), sem depender da tela;
--  - reajuste PROPOSTO sozinho perto da data-base (acumulado de 12 meses, do 13º ao 2º mês antes dela; ou o percentual fixo),
--    que continua precisando de aprovação;
--  - parcelas do fluxo geradas sozinhas até N meses à frente;
--  - avisos: reajuste proposto, prazo do aviso prévio, fim de vigência e renovação automática.
-- Tudo configurável por empresa (contrato_config). Aditivo.

create table if not exists public.indices_economicos (
  indice text not null check (indice in ('IPCA', 'IGP-M', 'INPC')),
  mes date not null check (mes = date_trunc('month', mes)::date),
  pct numeric(9,4) not null,
  fonte text not null,
  atualizado_em timestamptz not null default now(),
  primary key (indice, mes)
);
alter table public.indices_economicos enable row level security;
drop policy if exists indices_sel on public.indices_economicos;
create policy indices_sel on public.indices_economicos for select to authenticated using (true);
grant select on public.indices_economicos to authenticated;

create table if not exists public.indices_requisicoes (id bigint primary key, indice text not null, criado_em timestamptz not null default now());
alter table public.indices_requisicoes enable row level security;

create table if not exists public.contrato_config (
  empresa_id uuid primary key references public.empresas(id) on delete cascade,
  propor_reajuste boolean not null default true,
  dias_antes_reajuste smallint not null default 30 check (dias_antes_reajuste between 0 and 120),
  gerar_parcelas boolean not null default true,
  meses_parcelas smallint not null default 12 check (meses_parcelas between 1 and 36),
  avisar boolean not null default true,
  dias_aviso_vencimento smallint not null default 30 check (dias_aviso_vencimento between 0 and 180),
  papeis text[] not null default array['admin'],
  atualizado_em timestamptz not null default now()
);
alter table public.contrato_config enable row level security;
drop policy if exists contrato_config_sel on public.contrato_config;
create policy contrato_config_sel on public.contrato_config for select to authenticated using (public.is_admin(empresa_id));
drop policy if exists contrato_config_ins on public.contrato_config;
create policy contrato_config_ins on public.contrato_config for insert to authenticated with check (public.is_admin(empresa_id));
drop policy if exists contrato_config_upd on public.contrato_config;
create policy contrato_config_upd on public.contrato_config for update to authenticated using (public.is_admin(empresa_id)) with check (public.is_admin(empresa_id));
grant select, insert, update on public.contrato_config to authenticated;
drop trigger if exists zz_auditoria on public.contrato_config;
create trigger zz_auditoria after insert or update or delete on public.contrato_config for each row execute function public._auditar();

create table if not exists public.contrato_alertas_enviados (
  contrato_id uuid not null references public.contratos(id) on delete cascade,
  tipo text not null, ref date not null, enviado_em timestamptz not null default now(),
  primary key (contrato_id, tipo, ref)
);
alter table public.contrato_alertas_enviados enable row level security;

insert into public.notif_tipos(codigo, grupo, nome, descricao, urgente, ordem)
values ('contratos', 'Administração', 'Contratos: reajuste, aviso prévio e vencimento', 'Reajuste proposto pelo índice, prazo do aviso prévio, fim de vigência e renovação automática.', false, 97)
on conflict (codigo) do nothing;

-- ------------------------------------------------------------------ índices: lê as respostas pendentes e pede de novo (uma vez por dia)
create or replace function public._indice_cod(p text) returns int language sql immutable as $$
  select case p when 'IPCA' then 433 when 'IGP-M' then 189 when 'INPC' then 188 end
$$;

-- grava a resposta da série (lista [{data: 'dd/mm/aaaa', valor: '0,44'}]); separado para poder testar sem rede
create or replace function public._indices_gravar(p_indice text, p_json jsonb) returns int language plpgsql security definer set search_path = public as $$
declare x jsonb; n int := 0;
begin
  if jsonb_typeof(p_json) <> 'array' then return 0; end if;
  for x in select * from jsonb_array_elements(p_json) loop
    begin
      insert into indices_economicos(indice, mes, pct, fonte, atualizado_em)
        values (p_indice, date_trunc('month', to_date(x ->> 'data', 'DD/MM/YYYY'))::date, replace(x ->> 'valor', ',', '.')::numeric, 'Banco Central, série ' || _indice_cod(p_indice), now())
      on conflict (indice, mes) do update set pct = excluded.pct, atualizado_em = now();
      n := n + 1;
    exception when others then null;
    end;
  end loop;
  return n;
end $$;

create or replace function public._indices_atualizar() returns void language plpgsql security definer set search_path = public as $$
declare r record; v_resp record; i text; v_id bigint; v_ini text := to_char(date_trunc('month', current_date) - interval '24 months', 'DD/MM/YYYY');
begin
  if to_regclass('net._http_response') is not null then
    for r in select * from indices_requisicoes loop
      execute 'select status_code, content from net._http_response where id = $1' into v_resp using r.id;
      if v_resp.status_code is not null then
        if v_resp.status_code = 200 then perform public._indices_gravar(r.indice, v_resp.content::jsonb); end if;
        delete from indices_requisicoes where id = r.id;
      elsif r.criado_em < now() - interval '1 day' then delete from indices_requisicoes where id = r.id;
      end if;
    end loop;
  end if;
  if to_regprocedure('net.http_get(text,jsonb,jsonb,integer)') is null then return; end if;
  foreach i in array array['IPCA', 'IGP-M', 'INPC'] loop
    if exists (select 1 from indices_requisicoes where indice = i) then continue; end if;
    execute 'select net.http_get($1)' into v_id using format('https://api.bcb.gov.br/dados/serie/bcdata.sgs.%s/dados?formato=json&dataInicial=%s', _indice_cod(i), v_ini);
    insert into indices_requisicoes(id, indice) values (v_id, i) on conflict do nothing;
  end loop;
end $$;

-- acumulado de 12 meses para a data-base (do 13º ao 2º mês antes dela); null se faltar algum mês
create or replace function public.indice_acumulado(p_indice text, p_data_base date) returns jsonb language sql stable security definer set search_path = public as $$
  with j as (select (date_trunc('month', p_data_base) - interval '13 months')::date ini, (date_trunc('month', p_data_base) - interval '2 months')::date fim),
  m as (select e.* from indices_economicos e, j where e.indice = p_indice and e.mes between j.ini and j.fim)
  select case when (select count(*) from m) = 12 then jsonb_build_object('percentual', round((exp(sum(ln(1 + pct / 100))) - 1) * 100, 4),
      'fonte', format('Banco Central, série %s (%s), %s a %s (automático)', _indice_cod(p_indice), p_indice, to_char((select ini from j), 'MM/YYYY'), to_char((select fim from j), 'MM/YYYY'))) end
    from m
$$;

-- ------------------------------------------------------------------ parcelas: mesma regra do contrato_gerar_parcelas, sem a checagem de usuário
create or replace function public._contrato_parcelas(p_contrato uuid, p_ate date) returns int language plpgsql security definer set search_path = public as $$
declare c contratos; m int; d date; ate date; n int := 0; k int := 0; dv date;
begin
  select * into c from contratos where id = p_contrato;
  if c.id is null or c.natureza = 'sem_valor' or c.periodicidade = 'sem_valor' or c.valor <= 0 or c.plano_id is null or c.status <> 'vigente' then return 0; end if;
  ate := least(p_ate, coalesce(c.fim, '9999-12-31'::date));
  m := _contrato_meses(c.periodicidade);
  loop
    if m = 0 then d := c.inicio; else d := (c.inicio + make_interval(months => k * m))::date; end if;
    exit when d > ate;
    dv := case when c.dia_vencimento is null then d
               else (date_trunc('month', d) + make_interval(days => least(c.dia_vencimento, extract(day from (date_trunc('month', d) + interval '1 month - 1 day'))::int) - 1))::date end;
    if not exists (select 1 from lancamentos where contrato_id = c.id and date_trunc('month', data) = date_trunc('month', dv)) then
      insert into lancamentos (empresa_id, data, plano_id, centro_custo_id, conta_id, favorecido_id, valor, status, descricao, documento, origem, contrato_id)
      values (c.empresa_id, dv, c.plano_id, c.centro_custo_id, c.conta_id, c.favorecido_id, c.valor, 'Em aberto',
              left(format('Contrato nº %s — %s — %s', c.numero, c.parte_nome, c.objeto), 250), 'CT ' || c.numero, 'contrato', c.id);
      n := n + 1;
    end if;
    exit when m = 0;
    k := k + 1;
  end loop;
  return n;
end $$;
revoke all on function public._contrato_parcelas(uuid, date) from public, anon, authenticated;

-- ------------------------------------------------------------------ rotina diária por empresa
create or replace function public._contratos_rotina_empresa(p_empresa uuid, p_hoje date) returns jsonb language plpgsql security definer set search_path = public as $$
declare cfg contrato_config; c contratos; A jsonb; v_pct numeric; v_fonte text; v_users uuid[]; n_rea int := 0; n_parc int := 0; n_av int := 0; v_lim date;
begin
  select * into cfg from contrato_config where empresa_id = p_empresa;
  cfg.propor_reajuste := coalesce(cfg.propor_reajuste, true); cfg.dias_antes_reajuste := coalesce(cfg.dias_antes_reajuste, 30); cfg.gerar_parcelas := coalesce(cfg.gerar_parcelas, true);
  cfg.meses_parcelas := coalesce(cfg.meses_parcelas, 12); cfg.avisar := coalesce(cfg.avisar, true); cfg.dias_aviso_vencimento := coalesce(cfg.dias_aviso_vencimento, 30);
  v_users := public._usuarios_papel(p_empresa, coalesce(cfg.papeis, array['admin']));
  for c in select * from contratos where empresa_id = p_empresa and status = 'vigente' loop
    -- reajuste proposto perto da data-base
    if cfg.propor_reajuste and c.data_base is not null and c.indice <> 'nenhum' and c.natureza <> 'sem_valor' and c.valor > 0
       and c.data_base <= p_hoje + cfg.dias_antes_reajuste and not exists (select 1 from contrato_reajustes where contrato_id = c.id and data_base = c.data_base) then
      v_pct := null;
      if c.indice = 'fixo' then v_pct := c.reajuste_fixo_pct; v_fonte := 'Percentual fixo do contrato (automático)';
      else A := public.indice_acumulado(c.indice, c.data_base); v_pct := (A ->> 'percentual')::numeric; v_fonte := A ->> 'fonte'; end if;
      if v_pct is not null then
        insert into contrato_reajustes(empresa_id, contrato_id, data_base, indice, percentual, valor_anterior, valor_novo, fonte, proposto_por)
          values (p_empresa, c.id, c.data_base, c.indice, v_pct, c.valor, round(c.valor * (1 + v_pct / 100), 2), v_fonte, null);
        n_rea := n_rea + 1;
        if cfg.avisar then
          perform public._notificar_u(p_empresa, v_users, 'contratos', format('Reajuste proposto: contrato nº %s', c.numero),
            format('%s — %s: %s%% (%s), de %s para %s a partir de %s. Aprove ou recuse na ficha do contrato.', c.parte_nome, c.indice, trim(to_char(v_pct, 'FM9990D00')), coalesce(v_fonte, ''),
              to_char(c.valor, 'FM999G999G990D00'), to_char(round(c.valor * (1 + v_pct / 100), 2), 'FM999G999G990D00'), to_char(c.data_base, 'DD/MM/YYYY')), '#/contratos?abrir=' || c.id, c.id, false);
        end if;
      end if;
    end if;
    -- parcelas até N meses
    if cfg.gerar_parcelas and c.plano_id is not null then n_parc := n_parc + public._contrato_parcelas(c.id, (p_hoje + make_interval(months => cfg.meses_parcelas))::date); end if;
    -- avisos de prazo (uma vez por data de referência)
    if cfg.avisar and c.fim is not null then
      v_lim := c.fim - c.aviso_previo_dias;
      if not c.renovacao_automatica and v_lim between p_hoje and p_hoje + cfg.dias_aviso_vencimento then
        insert into contrato_alertas_enviados(contrato_id, tipo, ref) values (c.id, 'aviso_previo', v_lim) on conflict do nothing;
        if found then perform public._notificar_u(p_empresa, v_users, 'contratos', format('Aviso prévio: contrato nº %s', c.numero),
          format('%s — o prazo para avisar que não vai renovar termina em %s (fim em %s).', c.parte_nome, to_char(v_lim, 'DD/MM/YYYY'), to_char(c.fim, 'DD/MM/YYYY')), '#/contratos?abrir=' || c.id, c.id, true); n_av := n_av + 1; end if;
      end if;
      if c.fim between p_hoje and p_hoje + cfg.dias_aviso_vencimento then
        insert into contrato_alertas_enviados(contrato_id, tipo, ref) values (c.id, 'fim', c.fim) on conflict do nothing;
        if found then perform public._notificar_u(p_empresa, v_users, 'contratos', format('%s: contrato nº %s', case when c.renovacao_automatica then 'Renovação automática' else 'Fim de vigência' end, c.numero),
          format('%s — %s em %s.', c.parte_nome, case when c.renovacao_automatica then 'renova automaticamente' else 'termina' end, to_char(c.fim, 'DD/MM/YYYY')), '#/contratos?abrir=' || c.id, c.id, false); n_av := n_av + 1; end if;
      end if;
    end if;
  end loop;
  return jsonb_build_object('reajustes', n_rea, 'parcelas', n_parc, 'avisos', n_av);
end $$;
revoke all on function public._contratos_rotina_empresa(uuid, date) from public, anon, authenticated;

create or replace function public._contratos_rotina() returns void language plpgsql security definer set search_path = public as $$
declare e uuid;
begin
  perform public._indices_atualizar();
  for e in select distinct empresa_id from contratos where status = 'vigente' loop
    begin perform public._contratos_rotina_empresa(e, (now() at time zone 'America/Recife')::date); exception when others then raise warning 'contratos %: %', e, sqlerrm; end;
  end loop;
end $$;
revoke all on function public._contratos_rotina() from public, anon, authenticated;

-- rodar agora pela tela (administrador): a parte da empresa
create or replace function public.contratos_rodar_agora(p_empresa uuid) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin(p_empresa) then raise exception 'Só administradores'; end if;
  return public._contratos_rotina_empresa(p_empresa, (now() at time zone 'America/Recife')::date);
end $$;
revoke all on function public.contratos_rodar_agora(uuid) from public, anon;
grant execute on function public.contratos_rodar_agora(uuid) to authenticated;
revoke all on function public.indice_acumulado(text, date) from public, anon;
grant execute on function public.indice_acumulado(text, date) to authenticated;

-- o reajuste automático não tem quem propôs
alter table public.contrato_reajustes alter column proposto_por drop not null;

do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('contratos-rotina') where exists (select 1 from cron.job where jobname = 'contratos-rotina');
    perform cron.schedule('contratos-rotina', '15 10 * * *', 'select public._contratos_rotina()');
    perform cron.unschedule('indices-ler') where exists (select 1 from cron.job where jobname = 'indices-ler');
    perform cron.schedule('indices-ler', '45 10 * * *', 'select public._indices_atualizar()');   -- lê as respostas pedidas às 10h15
  end if;
end $$;

comment on table public.indices_economicos is 'IPCA, IGP-M e INPC mensais baixados do Banco Central (SGS) para os reajustes de contratos (melhoria 10.4)';

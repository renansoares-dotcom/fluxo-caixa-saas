-- Melhoria 8.3 — Horas apontadas na produção × horas pagas na folha, por pessoa e por setor.
-- Liga o operador da produção ao colaborador do RH; soma as horas apontadas (intervalos sobrepostos do mesmo operador contam uma vez;
-- apontamento aberto ou longo demais é limitado) e compara com as horas pagas (jornada do mês proporcional aos dias, menos férias, mais horas extras).
-- Só quem vê o RH (salários). Aditivo.

alter table public.prod_operadores add column if not exists colaborador_id uuid references public.rh_colaboradores(id) on delete set null;
create unique index if not exists prod_oper_colab on public.prod_operadores(empresa_id, colaborador_id) where colaborador_id is not null;

create table if not exists public.hf_config (
  empresa_id uuid primary key references public.empresas(id) on delete cascade,
  horas_mes numeric(6,2) not null default 220 check (horas_mes > 0),
  limite_apontamento_h numeric(5,2) not null default 12 check (limite_apontamento_h > 0),
  descontar_ferias boolean not null default true,
  setores_rh text[] not null default '{}',              -- setores do RH na comparação (vazio = quem tem operador ligado)
  meta_pct numeric(5,2) not null default 85 check (meta_pct between 0 and 100),
  atualizado_em timestamptz not null default now()
);
alter table public.hf_config enable row level security;
drop policy if exists hf_config_sel on public.hf_config;
create policy hf_config_sel on public.hf_config for select to authenticated using (public.ve_rh(empresa_id));
drop policy if exists hf_config_ins on public.hf_config;
create policy hf_config_ins on public.hf_config for insert to authenticated with check (public.edita_rh(empresa_id));
drop policy if exists hf_config_upd on public.hf_config;
create policy hf_config_upd on public.hf_config for update to authenticated using (public.edita_rh(empresa_id)) with check (public.edita_rh(empresa_id));
grant select, insert, update on public.hf_config to authenticated;
drop trigger if exists zz_auditoria on public.hf_config;
create trigger zz_auditoria after insert or update or delete on public.hf_config for each row execute function public._auditar();

-- operador e colaborador da mesma empresa
create or replace function public._prod_oper_colab() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.colaborador_id is not null and (select empresa_id from rh_colaboradores where id = new.colaborador_id) is distinct from new.empresa_id then raise exception 'Colaborador de outra empresa'; end if;
  return new;
end $$;
drop trigger if exists prod_oper_colab on public.prod_operadores;
create trigger prod_oper_colab before insert or update of colaborador_id on public.prod_operadores for each row execute function public._prod_oper_colab();

-- ligar operador × colaborador (RH): a tabela prod_operadores é da produção, então a ligação passa por aqui
create or replace function public.hf_ligar(p_operador uuid, p_colaborador uuid) returns void language plpgsql security definer set search_path = public as $$
declare v_emp uuid;
begin
  select empresa_id into v_emp from prod_operadores where id = p_operador;
  if v_emp is null or not public.edita_rh(v_emp) then raise exception 'Sem permissão no RH'; end if;
  if p_colaborador is not null then update prod_operadores set colaborador_id = null where empresa_id = v_emp and colaborador_id = p_colaborador and id <> p_operador; end if;
  update prod_operadores set colaborador_id = p_colaborador where id = p_operador;
end $$;

-- sugestões de ligação: mesma matrícula (sem zeros à esquerda) ou mesmo nome
create or replace function public.hf_sugerir(p_empresa uuid) returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.edita_rh(p_empresa) then raise exception 'Sem permissão no RH'; end if;
  with s as (
    select distinct on (o.id) o.id oid, c.id cid from prod_operadores o join rh_colaboradores c on c.empresa_id = o.empresa_id and c.situacao <> 'desligado'
      and ((nullif(ltrim(o.matricula, '0'), '') is not null and ltrim(o.matricula, '0') = ltrim(c.matricula, '0')) or upper(unaccent_simples(o.nome)) = upper(unaccent_simples(c.nome)))
     where o.empresa_id = p_empresa and o.colaborador_id is null
       and not exists (select 1 from prod_operadores x where x.empresa_id = p_empresa and x.colaborador_id = c.id)
     order by o.id, (ltrim(o.matricula, '0') = ltrim(c.matricula, '0')) desc
  )
  update prod_operadores o set colaborador_id = s.cid from s where o.id = s.oid;
  get diagnostics n = row_count;
  return n;
end $$;

-- sem depender da extensão unaccent
create or replace function public.unaccent_simples(t text) returns text language sql immutable as $$
  select translate(coalesce(t, ''), 'ÁÀÂÃÄáàâãäÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇçÑñ', 'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNn')
$$;

-- horas por colaborador no mês
create or replace function public.hf_horas(p_empresa uuid, p_mes date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_ini date := date_trunc('month', p_mes)::date; v_fim date := (date_trunc('month', p_mes) + interval '1 month - 1 day')::date;
  v_dias int := extract(day from (date_trunc('month', p_mes) + interval '1 month - 1 day'))::int; cfg hf_config; v jsonb;
begin
  if not public.ve_rh(p_empresa) then raise exception 'Sem acesso ao RH'; end if;
  select * into cfg from hf_config where empresa_id = p_empresa;
  cfg.horas_mes := coalesce(cfg.horas_mes, 220); cfg.limite_apontamento_h := coalesce(cfg.limite_apontamento_h, 12); cfg.descontar_ferias := coalesce(cfg.descontar_ferias, true);
  with ap as (   -- apontamentos do mês com operador ligado, cortados no mês e no limite
    select o.colaborador_id cid, a.setor_id, greatest(a.inicio, v_ini::timestamptz) i,
           least(coalesce(a.fim, a.inicio + make_interval(hours => 0)), a.inicio + make_interval(secs => (cfg.limite_apontamento_h * 3600)::int), (v_fim + 1)::timestamptz) f
      from prod_apontamentos a join prod_operadores o on o.id = a.operador_id
     where a.empresa_id = p_empresa and o.colaborador_id is not null and a.fim is not null and a.inicio < (v_fim + 1)::timestamptz and a.fim > v_ini::timestamptz
  ), ord as (   -- junta intervalos sobrepostos do mesmo colaborador
    select cid, setor_id, i, f, case when i <= max(f) over (partition by cid order by i, f rows between unbounded preceding and 1 preceding) then 0 else 1 end novo from ap where f > i
  ), grp as (select cid, setor_id, i, f, sum(novo) over (partition by cid order by i, f) g from ord),
  blocos as (select cid, g, min(i) i, max(f) f from grp group by cid, g),
  apont as (select cid, round(sum(extract(epoch from f - i)) / 3600.0, 2) horas from blocos group by cid),
  porsetor as (select cid, (array_agg(setor_id order by s desc))[1] setor_prod from (select cid, setor_id, sum(extract(epoch from f - i)) s from ap where f > i group by cid, setor_id) z group by cid),
  he as (select colaborador_id cid, sum(horas_1 + horas_2) horas from rh_horas_extras where empresa_id = p_empresa and competencia = v_ini group by 1),
  fe as (select colaborador_id cid, sum(greatest(0, least(gozo_ini + dias - 1, v_fim) - greatest(gozo_ini, v_ini) + 1)) dias
           from rh_ferias where empresa_id = p_empresa and situacao <> 'cancelada' and gozo_ini <= v_fim and gozo_ini + dias - 1 >= v_ini group by 1),
  col as (
    select c.* from rh_colaboradores c where c.empresa_id = p_empresa and coalesce(c.admissao, v_ini) <= v_fim and (c.demissao is null or c.demissao >= v_ini)
      and c.vinculo in ('clt', 'aprendiz', 'extra_folha')
      and (case when cardinality(coalesce(cfg.setores_rh, '{}')) > 0 then c.setor = any(cfg.setores_rh) else exists (select 1 from prod_operadores o where o.colaborador_id = c.id) end)
  )
  select jsonb_build_object('mes', v_ini, 'horas_mes', cfg.horas_mes, 'meta_pct', coalesce(cfg.meta_pct, 85),
    'pessoas', coalesce(jsonb_agg(jsonb_build_object('colaborador_id', c.id, 'nome', c.nome, 'cargo', c.cargo, 'setor', coalesce(c.setor, '—'), 'salario', c.salario, 'situacao', c.situacao,
      'setor_prod', (select nome from prod_setores where id = ps.setor_prod),
      'dias_ativos', greatest(0, least(coalesce(c.demissao, v_fim), v_fim) - greatest(coalesce(c.admissao, v_ini), v_ini) + 1),
      'dias_ferias', case when cfg.descontar_ferias then coalesce(fe.dias, 0) else 0 end,
      'horas_contrato', round(cfg.horas_mes * greatest(0, (least(coalesce(c.demissao, v_fim), v_fim) - greatest(coalesce(c.admissao, v_ini), v_ini) + 1)
                         - case when cfg.descontar_ferias then coalesce(fe.dias, 0) else 0 end)::numeric / v_dias, 2),
      'horas_extras', coalesce(he.horas, 0), 'horas_apontadas', coalesce(ap.horas, 0),
      'ligado', exists (select 1 from prod_operadores o where o.colaborador_id = c.id)) order by c.setor, c.nome), '[]'),
    'operadores_sem_ligacao', (select coalesce(jsonb_agg(jsonb_build_object('operador_id', o.id, 'nome', o.nome, 'matricula', o.matricula,
        'horas', round((select sum(extract(epoch from least(a.fim, a.inicio + make_interval(secs => (cfg.limite_apontamento_h * 3600)::int)) - a.inicio)) from prod_apontamentos a
                        where a.operador_id = o.id and a.fim is not null and a.inicio >= v_ini and a.inicio < (v_fim + 1)) / 3600.0, 2)) order by o.nome), '[]')
      from prod_operadores o where o.empresa_id = p_empresa and o.colaborador_id is null and o.ativo
       and exists (select 1 from prod_apontamentos a where a.operador_id = o.id and a.inicio >= v_ini and a.inicio < (v_fim + 1))))
    into v
    from col c left join apont ap on ap.cid = c.id left join porsetor ps on ps.cid = c.id left join he on he.cid = c.id left join fe on fe.cid = c.id;
  return v;
end $$;

-- operadores e colaboradores para a tela de ligação
create or replace function public.hf_operadores(p_empresa uuid) returns jsonb language sql stable security definer set search_path = public as $$
  select case when public.ve_rh(p_empresa) then (select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'nome', o.nome, 'matricula', o.matricula, 'ativo', o.ativo, 'colaborador_id', o.colaborador_id) order by o.nome), '[]')
    from prod_operadores o where o.empresa_id = p_empresa) end
$$;

do $$ declare f text; begin
  foreach f in array array['hf_ligar(uuid, uuid)', 'hf_sugerir(uuid)', 'hf_horas(uuid, date)', 'hf_operadores(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

comment on table public.hf_config is 'Horas apontadas × horas pagas: jornada do mês, limite do apontamento, setores e meta (melhoria 8.3)';

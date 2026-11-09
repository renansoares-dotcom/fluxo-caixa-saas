-- Recuperadora — parte 3: balanço de massa do mês, controle ambiental (destinação de rejeitos com MTR e CDF, licenças com validade),
-- fiscal (crédito presumido de CBS e IBS na compra de coletor incentivado — LC 214/2025, art. 170 — e crédito de PIS/COFINS na compra
-- de pessoa jurídica, por vigência e com a fonte), alertas para a Central de Decisões e aviso diário das licenças. Tudo configurável. Aditivo.

alter table public.rec_config add column if not exists balanco_tolerancia_pct numeric(5,2) not null default 2 check (balanco_tolerancia_pct between 0 and 50);
alter table public.rec_config add column if not exists licenca_antecedencia_dias int not null default 60 check (licenca_antecedencia_dias between 1 and 365);
alter table public.rec_config add column if not exists ensaio_alerta_dias int not null default 2 check (ensaio_alerta_dias between 0 and 60);
alter table public.rec_config add column if not exists adiant_alerta_dias int not null default 30 check (adiant_alerta_dias between 1 and 365);
alter table public.rec_config add column if not exists plano_residuos_id uuid references public.plano_contas(id) on delete set null;  -- título a pagar da destinação
alter table public.rec_config add column if not exists avisar_licencas boolean not null default true;

-- ---------- destinação de resíduos (rejeito, lodo da lavagem, borra…) ----------
create table if not exists public.rec_residuos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  data date not null default current_date,
  tipo text not null default 'rejeito' check (tipo in ('rejeito', 'lodo', 'borra', 'finos', 'outro')),
  kg numeric(14,3) not null check (kg > 0),
  transportador_id uuid references public.favorecidos(id) on delete set null,
  destinador_id uuid references public.favorecidos(id) on delete set null,
  destinacao text,                                           -- aterro, coprocessamento, reciclagem…
  mtr_numero text, mtr_data date,                            -- Manifesto de Transporte de Resíduos (SINIR)
  cdf_numero text, cdf_data date,                            -- Certificado de Destinação Final
  valor numeric(14,2) not null default 0 check (valor >= 0),
  lancamento_id uuid references public.lancamentos(id) on delete set null,
  arquivos jsonb not null default '[]',
  observacao text,
  criado_por uuid default auth.uid(),
  criado_em timestamptz not null default now()
);
create index if not exists rec_residuos_d on public.rec_residuos(empresa_id, data);

-- ---------- licenças e documentos ambientais ----------
create table if not exists public.rec_licencas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  tipo text not null,                                        -- Licença de Operação, CTF/IBAMA, outorga de água, AVCB, CADRI…
  numero text, orgao text,
  emissao date, validade date,
  antecedencia_dias int check (antecedencia_dias is null or antecedencia_dias between 1 and 365),   -- vazio = o padrão dos parâmetros
  arquivos jsonb not null default '[]',
  observacao text,
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);
create table if not exists public.rec_licencas_avisos (
  licenca_id uuid not null references public.rec_licencas(id) on delete cascade,
  etapa text not null check (etapa in ('antecedencia', 'vencida')),
  validade date not null,
  enviado_em timestamptz not null default now(),
  primary key (licenca_id, etapa, validade)
);

-- ---------- parâmetros fiscais por vigência (com a fonte; nada suposto) ----------
create table if not exists public.rec_fiscal_param (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  vigencia date not null,
  cbs_presumido_pct numeric(6,3) not null default 0 check (cbs_presumido_pct between 0 and 100),   -- sobre o valor da compra de coletor incentivado
  ibs_presumido_pct numeric(6,3) not null default 0 check (ibs_presumido_pct between 0 and 100),
  pis_cofins_pct numeric(6,3) not null default 0 check (pis_cofins_pct between 0 and 100),         -- crédito na compra de pessoa jurídica (não cumulativo)
  fonte text not null,
  unique (empresa_id, vigencia)
);

-- ---------- segurança ----------
do $$ declare t text; begin
  foreach t in array array['rec_residuos', 'rec_licencas', 'rec_fiscal_param'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_sel', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.ve_producao(empresa_id))', t || '_sel', t);
    execute format('drop policy if exists %I on public.%I', t || '_ins', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.pode_pcp(empresa_id))', t || '_ins', t);
    execute format('drop policy if exists %I on public.%I', t || '_upd', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.pode_pcp(empresa_id)) with check (public.pode_pcp(empresa_id))', t || '_upd', t);
    execute format('drop policy if exists %I on public.%I', t || '_del', t);
    execute format('create policy %I on public.%I for delete to authenticated using (public.pode_pcp(empresa_id))', t || '_del', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('drop trigger if exists zz_auditoria on public.%I', t);
    execute format('create trigger zz_auditoria after insert or update or delete on public.%I for each row execute function public._auditar()', t);
  end loop;
end $$;
alter table public.rec_licencas_avisos enable row level security;
revoke all on public.rec_licencas_avisos from anon, authenticated;

-- destinação: título a pagar do custo (quando há valor e a conta nos parâmetros) e vínculos da mesma empresa
create or replace function public._rec_residuo_antes() returns trigger language plpgsql security definer set search_path = public as $$
declare cfg rec_config; v uuid;
begin
  if (new.transportador_id is not null and (select empresa_id from favorecidos where id = new.transportador_id) is distinct from new.empresa_id)
     or (new.destinador_id is not null and (select empresa_id from favorecidos where id = new.destinador_id) is distinct from new.empresa_id) then
    raise exception 'Transportador ou destinador de outra empresa';
  end if;
  if tg_op = 'INSERT' and new.valor > 0 and new.lancamento_id is null then
    select * into cfg from rec_config where empresa_id = new.empresa_id;
    if cfg.plano_residuos_id is not null then
      insert into lancamentos(empresa_id, data, plano_id, favorecido_id, status, valor, descricao, documento, origem)
      values (new.empresa_id, new.data, cfg.plano_residuos_id, coalesce(new.destinador_id, new.transportador_id), 'Em aberto', new.valor,
              'Destinação de resíduo (' || new.tipo || ', ' || new.kg || ' kg)' || coalesce(' — MTR ' || new.mtr_numero, ''), coalesce('MTR ' || new.mtr_numero, 'REC RES'), 'recuperadora')
      returning id into v;
      new.lancamento_id := v;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists rec_residuo_antes on public.rec_residuos;
create trigger rec_residuo_antes before insert or update on public.rec_residuos for each row execute function public._rec_residuo_antes();

-- ---------- estoque de lotes numa data (antes do dia p_dia): peso dos lotes − consumido nas ordens − saídas ----------
create or replace function public._rec_estoque_em(p_empresa uuid, p_dia date, p_grao boolean) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce((select sum(peso_kg) from rec_lotes where empresa_id = p_empresa and data < p_dia and situacao <> 'cancelado' and (tipo = 'grao') = p_grao), 0)
       - coalesce((select sum(e.kg) from rec_ordem_entradas e join rec_lotes l on l.id = e.lote_id join rec_ordens o on o.id = e.ordem_id
                    where e.empresa_id = p_empresa and o.situacao <> 'cancelada' and (e.criado_em at time zone 'America/Sao_Paulo')::date < p_dia and (l.tipo = 'grao') = p_grao), 0)
       - coalesce((select sum(s.kg) from rec_lote_saidas s join rec_lotes l on l.id = s.lote_id where s.empresa_id = p_empresa and s.data < p_dia and (l.tipo = 'grao') = p_grao), 0)
$$;

-- ---------- balanço de massa do mês ----------
create or replace function public.rec_balanco(p_empresa uuid, p_mes date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_ini date := date_trunc('month', p_mes)::date; v_fim date := (date_trunc('month', p_mes) + interval '1 month - 1 day')::date; cfg rec_config; v jsonb;
  pesado numeric; pago numeric; aparas numeric; outras numeric; consumido numeric; produzido numeric; entrada_ord numeric; perdas jsonb; saidas jsonb; residuos jsonb; rej_apont numeric; rej_dest numeric;
  ei_m numeric; ef_m numeric; ei_g numeric; ef_g numeric; perda_ord numeric; perda_apont numeric;
begin
  if not public.ve_producao(p_empresa) then raise exception 'Acesso negado.'; end if;
  select * into cfg from rec_config where empresa_id = p_empresa;
  select coalesce(sum(i.peso_kg) filter (where t.origem = 'compra'), 0), coalesce(sum(i.peso_pago) filter (where t.origem = 'compra'), 0), coalesce(sum(i.peso_pago) filter (where t.origem <> 'compra'), 0)
    into pesado, pago, outras
    from rec_tickets t join rec_ticket_itens i on i.ticket_id = t.id
   where t.empresa_id = p_empresa and t.situacao = 'fechado' and (t.data_hora at time zone 'America/Sao_Paulo')::date between v_ini and v_fim;
  select coalesce(sum(peso_kg), 0) into aparas from rec_lotes where empresa_id = p_empresa and tipo = 'apara' and data between v_ini and v_fim and situacao <> 'cancelado';
  select coalesce(sum(e.kg), 0) into consumido from rec_ordem_entradas e join rec_ordens o on o.id = e.ordem_id
   where e.empresa_id = p_empresa and o.situacao <> 'cancelada' and (e.criado_em at time zone 'America/Sao_Paulo')::date between v_ini and v_fim;
  select coalesce(sum(peso_saida), 0), coalesce(sum(peso_entrada), 0) into produzido, entrada_ord from rec_ordens where empresa_id = p_empresa and situacao = 'concluida' and data between v_ini and v_fim;
  select jsonb_build_object('umidade', coalesce(sum(t.perda_umidade), 0), 'sujeira', coalesce(sum(t.perda_sujeira), 0), 'finos', coalesce(sum(t.perda_finos), 0), 'rejeito', coalesce(sum(t.perda_rejeito), 0)),
         coalesce(sum(t.perda_umidade + t.perda_sujeira + t.perda_finos + t.perda_rejeito), 0), coalesce(sum(t.perda_rejeito), 0)
    into perdas, perda_apont, rej_apont
    from rec_ordem_etapas t join rec_ordens o on o.id = t.ordem_id where o.empresa_id = p_empresa and o.situacao = 'concluida' and o.data between v_ini and v_fim;
  perda_ord := entrada_ord - produzido;
  select coalesce(jsonb_object_agg(destino, kg), '{}') into saidas from (select s.destino, sum(s.kg) kg from rec_lote_saidas s join rec_lotes l on l.id = s.lote_id
    where s.empresa_id = p_empresa and l.tipo = 'grao' and s.data between v_ini and v_fim group by 1) z;
  select coalesce(sum(kg), 0) into rej_dest from rec_residuos where empresa_id = p_empresa and data between v_ini and v_fim;
  select coalesce(jsonb_agg(jsonb_build_object('tipo', tipo, 'kg', kg, 'com_cdf', com_cdf, 'sem_cdf', sem_cdf)), '[]') into residuos
    from (select tipo, sum(kg) kg, sum(kg) filter (where cdf_numero is not null) com_cdf, sum(kg) filter (where cdf_numero is null) sem_cdf
            from rec_residuos where empresa_id = p_empresa and data between v_ini and v_fim group by tipo) z;
  ei_m := public._rec_estoque_em(p_empresa, v_ini, false); ef_m := public._rec_estoque_em(p_empresa, v_fim + 1, false);
  ei_g := public._rec_estoque_em(p_empresa, v_ini, true);  ef_g := public._rec_estoque_em(p_empresa, v_fim + 1, true);
  v := jsonb_build_object('mes', v_ini, 'tolerancia_pct', coalesce(cfg.balanco_tolerancia_pct, 2),
    'material', jsonb_build_object('estoque_inicial', ei_m, 'pesado', pesado, 'desconto', pesado - pago, 'comprado', pago, 'aparas', aparas, 'outras', outras, 'consumido', consumido, 'estoque_final', ef_m),
    'processo', jsonb_build_object('entrada', entrada_ord, 'produzido', produzido, 'perda', perda_ord, 'perda_apontada', perda_apont, 'nao_explicada', perda_ord - perda_apont,
                                   'nao_explicada_pct', round(100 * (perda_ord - perda_apont) / nullif(entrada_ord, 0), 2), 'rendimento', round(produzido / nullif(entrada_ord, 0), 4), 'perdas', perdas),
    'grao', jsonb_build_object('estoque_inicial', ei_g, 'produzido', produzido, 'saidas', saidas, 'estoque_final', ef_g),
    'residuos', jsonb_build_object('rejeito_apontado', rej_apont, 'destinado', rej_dest, 'por_tipo', residuos,
                                   'sem_cdf', coalesce((select sum(kg) from rec_residuos where empresa_id = p_empresa and cdf_numero is null and data <= v_fim), 0)));
  return v;
end $$;

-- ---------- relatório de toneladas recicladas (logística reversa, clientes) ----------
create or replace function public.rec_reciclado(p_empresa uuid, p_de date, p_ate date) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when public.ve_producao(p_empresa) then jsonb_build_object(
    'grao', coalesce((select jsonb_agg(jsonb_build_object('polimero', m.polimero, 'material', m.codigo || ' — ' || m.nome, 'kg', z.kg) order by z.kg desc)
        from (select material_saida_id, sum(peso_saida) kg from rec_ordens where empresa_id = p_empresa and situacao = 'concluida' and data between p_de and p_ate group by 1) z
        join rec_materiais m on m.id = z.material_saida_id), '[]'),
    'origem', coalesce((select jsonb_agg(jsonb_build_object('origem', o, 'kg', kg) order by kg desc) from (
        select case when t.origem <> 'compra' then 'Doação e transferência' when f.rec_coletor_incentivado then 'Catadores e cooperativas' else 'Empresas (sucateiros, aparistas, indústrias)' end o, sum(i.peso_pago) kg
          from rec_tickets t join rec_ticket_itens i on i.ticket_id = t.id left join favorecidos f on f.id = t.fornecedor_id
         where t.empresa_id = p_empresa and t.situacao = 'fechado' and (t.data_hora at time zone 'America/Sao_Paulo')::date between p_de and p_ate group by 1
        union all select 'Aparas da própria produção', sum(peso_kg) from rec_lotes where empresa_id = p_empresa and tipo = 'apara' and data between p_de and p_ate and situacao <> 'cancelado' having sum(peso_kg) > 0) z), '[]'),
    'residuos', coalesce((select jsonb_agg(jsonb_build_object('tipo', tipo, 'destinacao', destinacao, 'kg', kg) order by kg desc)
        from (select tipo, coalesce(destinacao, '—') destinacao, sum(kg) kg from rec_residuos where empresa_id = p_empresa and data between p_de and p_ate group by 1, 2) z), '[]')) end
$$;

-- ---------- fiscal: créditos da compra de material reciclável no período ----------
-- coletor incentivado (pessoa física, cooperativa ou associação de catadores): crédito presumido de CBS e IBS sobre o valor da compra;
-- pessoa jurídica (CNPJ) que não é coletor incentivado: crédito de PIS/COFINS. Percentual vigente na data de cada ticket.
create or replace function public.rec_fiscal(p_empresa uuid, p_de date, p_ate date) returns jsonb
language sql stable security definer set search_path = public as $$
  with c as (
    select t.id, t.numero, (t.data_hora at time zone 'America/Sao_Paulo')::date dia, f.id fid, f.nome, f.documento, f.rec_tipo, f.rec_coletor_incentivado ci,
           length(regexp_replace(coalesce(f.documento, ''), '\D', '', 'g')) = 14 pj, t.total valor,
           (select p from rec_fiscal_param p where p.empresa_id = p_empresa and p.vigencia <= (t.data_hora at time zone 'America/Sao_Paulo')::date order by p.vigencia desc limit 1) par
      from rec_tickets t join favorecidos f on f.id = t.fornecedor_id
     where t.empresa_id = p_empresa and t.situacao = 'fechado' and t.origem = 'compra' and (t.data_hora at time zone 'America/Sao_Paulo')::date between p_de and p_ate
  ), x as (
    select *, case when ci then round(valor * coalesce((par).cbs_presumido_pct, 0) / 100, 2) else 0 end cbs,
              case when ci then round(valor * coalesce((par).ibs_presumido_pct, 0) / 100, 2) else 0 end ibs,
              case when pj and not ci then round(valor * coalesce((par).pis_cofins_pct, 0) / 100, 2) else 0 end piscofins,
              (par).fonte fonte, (par).vigencia vig from c
  )
  select case when public.ve_producao(p_empresa) then jsonb_build_object(
    'total', (select jsonb_build_object('compras', coalesce(sum(valor), 0), 'coletor', coalesce(sum(valor) filter (where ci), 0), 'pj', coalesce(sum(valor) filter (where pj and not ci), 0),
                'outros', coalesce(sum(valor) filter (where not ci and not pj), 0), 'cbs', coalesce(sum(cbs), 0), 'ibs', coalesce(sum(ibs), 0), 'pis_cofins', coalesce(sum(piscofins), 0),
                'sem_parametro', count(*) filter (where vig is null)) from x),
    'fornecedores', coalesce((select jsonb_agg(jsonb_build_object('fornecedor', nome, 'documento', documento, 'rec_tipo', rec_tipo, 'coletor', ci, 'pj', pj, 'tickets', n, 'valor', v, 'cbs', cb, 'ibs', ib, 'pis_cofins', pc) order by v desc)
        from (select nome, documento, rec_tipo, ci, pj, count(*) n, sum(valor) v, sum(cbs) cb, sum(ibs) ib, sum(piscofins) pc from x group by fid, nome, documento, rec_tipo, ci, pj) z), '[]'),
    'meses', coalesce((select jsonb_agg(jsonb_build_object('mes', m, 'valor', v, 'cbs', cb, 'ibs', ib, 'pis_cofins', pc, 'fonte', fo) order by m)
        from (select date_trunc('month', dia)::date m, sum(valor) v, sum(cbs) cb, sum(ibs) ib, sum(piscofins) pc, string_agg(distinct fonte, '; ') fo from x group by 1) z), '[]')) end
$$;

-- percentuais do art. 170 da LC 214/2025 como ponto de partida (a empresa confere com a contabilidade e ajusta)
create or replace function public.rec_fiscal_carregar_lc214(p_empresa uuid) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.pode_pcp(p_empresa) then raise exception 'Acesso negado.'; end if;
  insert into rec_fiscal_param(empresa_id, vigencia, cbs_presumido_pct, ibs_presumido_pct, pis_cofins_pct, fonte)
  select p_empresa, v, c, i, 0, 'LC 214/2025, art. 170 (crédito presumido na compra de coletor incentivado) — conferir com a contabilidade'
    from (values ('2027-01-01'::date, 7.0, 0.0), ('2029-01-01', 7.0, 1.3), ('2030-01-01', 7.0, 2.6), ('2031-01-01', 7.0, 3.9), ('2032-01-01', 7.0, 5.2), ('2033-01-01', 7.0, 13.0)) z(v, c, i)
  on conflict (empresa_id, vigencia) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------- alertas da recuperadora (Central de Decisões) ----------
create or replace function public.rec_alertas(p_empresa uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare cfg rec_config; hoje date := (now() at time zone 'America/Sao_Paulo')::date; out jsonb := '[]'; n int; kgv numeric; b jsonb; mes_ant date;
begin
  if not public.ve_producao(p_empresa) then return '[]'; end if;
  select * into cfg from rec_config where empresa_id = p_empresa;
  if cfg.empresa_id is null or cfg.modo = 'desligado' then return '[]'; end if;
  -- licenças vencidas ou a vencer
  for b in select jsonb_build_object('tipo', tipo, 'numero', numero, 'validade', validade, 'dias', validade - hoje) from rec_licencas
            where empresa_id = p_empresa and ativo and validade is not null and validade - hoje <= coalesce(antecedencia_dias, cfg.licenca_antecedencia_dias) order by validade loop
    out := out || jsonb_build_object('k', 'licenca', 'nivel', case when (b ->> 'dias')::int < 0 then 'alto' when (b ->> 'dias')::int <= 15 then 'alto' else 'medio' end, 'item', b);
  end loop;
  -- grão sem ensaio há mais de N dias
  select count(*), coalesce(sum(saldo_kg), 0) into n, kgv from rec_lotes l where empresa_id = p_empresa and tipo = 'grao' and situacao = 'bloqueado'
     and not exists (select 1 from rec_ensaios e where e.lote_id = l.id) and data <= hoje - cfg.ensaio_alerta_dias;
  if n > 0 then out := out || jsonb_build_object('k', 'ensaio', 'nivel', 'medio', 'item', jsonb_build_object('lotes', n, 'kg', kgv)); end if;
  -- rendimento abaixo da meta nos últimos 30 dias
  select count(*) into n from rec_ordens where empresa_id = p_empresa and situacao = 'concluida' and data >= hoje - 30 and peso_saida / nullif(peso_entrada, 0) * 100 < cfg.meta_rendimento_pct;
  if n > 0 then out := out || jsonb_build_object('k', 'rendimento', 'nivel', case when n >= 3 then 'alto' else 'medio' end, 'item', jsonb_build_object('ordens', n, 'meta', cfg.meta_rendimento_pct,
    'rendimento', (select round(100 * sum(peso_saida) / nullif(sum(peso_entrada), 0), 1) from rec_ordens where empresa_id = p_empresa and situacao = 'concluida' and data >= hoje - 30))); end if;
  -- balanço do mês anterior: perda não explicada acima da tolerância
  mes_ant := (date_trunc('month', hoje) - interval '1 month')::date;
  b := public.rec_balanco(p_empresa, mes_ant) -> 'processo';
  if abs(coalesce((b ->> 'nao_explicada_pct')::numeric, 0)) > cfg.balanco_tolerancia_pct then
    out := out || jsonb_build_object('k', 'balanco', 'nivel', 'medio', 'item', jsonb_build_object('mes', mes_ant, 'kg', b -> 'nao_explicada', 'pct', b -> 'nao_explicada_pct'));
  end if;
  -- rejeito sem destinação comprovada (sem CDF)
  select coalesce(sum(kg), 0), count(*) into kgv, n from rec_residuos where empresa_id = p_empresa and cdf_numero is null and data <= hoje - 30;
  if n > 0 then out := out || jsonb_build_object('k', 'cdf', 'nivel', 'medio', 'item', jsonb_build_object('destinacoes', n, 'kg', kgv)); end if;
  -- adiantamentos antigos em aberto
  select count(*), coalesce(sum(a.valor - coalesce((select sum(x.valor) from rec_adiant_abatimentos x where x.adiantamento_id = a.id), 0)), 0) into n, kgv
    from rec_adiantamentos a where a.empresa_id = p_empresa and a.situacao = 'aberto' and a.data <= hoje - cfg.adiant_alerta_dias;
  if n > 0 then out := out || jsonb_build_object('k', 'adiantamento', 'nivel', 'medio', 'item', jsonb_build_object('qtd', n, 'valor', kgv, 'dias', cfg.adiant_alerta_dias)); end if;
  -- tickets abertos há mais de 2 dias
  select count(*) into n from rec_tickets where empresa_id = p_empresa and situacao = 'aberto' and (data_hora at time zone 'America/Sao_Paulo')::date <= hoje - 2;
  if n > 0 then out := out || jsonb_build_object('k', 'tickets', 'nivel', 'baixo', 'item', jsonb_build_object('qtd', n)); end if;
  return out;
end $$;

-- ---------- aviso diário das licenças (uma vez na antecedência, outra ao vencer) ----------
create or replace function public._rec_licencas_avisar(p_empresa uuid, p_hoje date) returns int
language plpgsql security definer set search_path = public as $$
declare cfg rec_config; l record; n int := 0; v_dest uuid[];
begin
  select * into cfg from rec_config where empresa_id = p_empresa;
  if cfg.empresa_id is null or cfg.modo = 'desligado' or not cfg.avisar_licencas then return 0; end if;
  v_dest := public._usuarios_papel(p_empresa, array['admin', 'diretor']);
  for l in select * from rec_licencas where empresa_id = p_empresa and ativo and validade is not null loop
    if l.validade < p_hoje then
      insert into rec_licencas_avisos(licenca_id, etapa, validade) values (l.id, 'vencida', l.validade) on conflict do nothing;
      if found then perform public._notificar_u(p_empresa, v_dest, 'rec_licenca', l.tipo || ' vencida', coalesce(l.numero || ' · ', '') || 'venceu em ' || to_char(l.validade, 'DD/MM/YYYY'), '#/recuperadora/ambiental', l.id, true); n := n + 1; end if;
    elsif l.validade - p_hoje <= coalesce(l.antecedencia_dias, cfg.licenca_antecedencia_dias) then
      insert into rec_licencas_avisos(licenca_id, etapa, validade) values (l.id, 'antecedencia', l.validade) on conflict do nothing;
      if found then perform public._notificar_u(p_empresa, v_dest, 'rec_licenca', l.tipo || ' vence em ' || (l.validade - p_hoje) || ' dia(s)', coalesce(l.numero || ' · ', '') || 'validade ' || to_char(l.validade, 'DD/MM/YYYY') || coalesce(' · ' || l.orgao, ''), '#/recuperadora/ambiental', l.id, false); n := n + 1; end if;
    end if;
  end loop;
  return n;
end $$;
create or replace function public._rec_licencas_rotina() returns void language plpgsql security definer set search_path = public as $$
declare e uuid;
begin
  for e in select distinct empresa_id from rec_licencas where ativo loop perform public._rec_licencas_avisar(e, (now() at time zone 'America/Sao_Paulo')::date); end loop;
end $$;
insert into public.notif_tipos(codigo, grupo, nome, descricao, urgente, ordem)
values ('rec_licenca', 'Produção', 'Licenças ambientais a vencer', 'Licença ou documento ambiental da recuperadora perto da validade ou vencido.', false, 98)
on conflict (codigo) do nothing;
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('rec-licencas') where exists (select 1 from cron.job where jobname = 'rec-licencas');
    perform cron.schedule('rec-licencas', '35 11 * * 1-5', 'select public._rec_licencas_rotina()');
  end if;
end $$;

do $$ declare f text; begin
  foreach f in array array['rec_balanco(uuid, date)', 'rec_reciclado(uuid, date, date)', 'rec_fiscal(uuid, date, date)', 'rec_fiscal_carregar_lc214(uuid)', 'rec_alertas(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  foreach f in array array['_rec_residuo_antes()', '_rec_estoque_em(uuid, date, boolean)', '_rec_licencas_avisar(uuid, date)', '_rec_licencas_rotina()'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;

comment on table public.rec_residuos is 'Recuperadora: destinação de rejeitos e lodo com MTR e CDF, custo e título a pagar (parte 3)';
comment on table public.rec_licencas is 'Recuperadora: licenças e documentos ambientais com validade e aviso (parte 3)';
comment on table public.rec_fiscal_param is 'Recuperadora: percentuais de crédito por vigência, com a fonte (CBS/IBS presumido art. 170 LC 214/2025; PIS/COFINS) (parte 3)';

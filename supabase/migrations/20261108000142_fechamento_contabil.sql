-- Melhoria 9.3 — Fechamento contábil assistido: provisões sugeridas (13º, férias e encargos, impostos da apuração fechada,
-- valores fixos do mês), geração dos lançamentos contábeis com um clique, conferência das contas bancárias do balancete
-- contra o saldo do fluxo de caixa, fechamento do mês e leiaute de exportação para o Domínio (o arquivo é montado na tela).
-- Aditivo: só cria tabelas e funções; os lançamentos gerados são contab_lancamentos com origem própria e podem ser desfeitos.

-- ------------------------------------------------------------------ regras das provisões (contas configuradas na tela)
create table if not exists public.contab_fech_regras (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  codigo text not null,
  nome text not null,
  tipo text not null check (tipo in ('decimo', 'ferias', 'encargos', 'icms', 'ipi', 'pis_cofins', 'feef_fecep', 'fixo')),
  ativo boolean not null default true,
  percentual numeric(9,4) check (percentual is null or percentual between 0 and 1000),   -- decimo/ferias: % da folha; encargos: % das provisões (null = INSS + FGTS do RH)
  valor_fixo numeric(14,2) check (valor_fixo is null or valor_fixo >= 0),
  conta_debito_id uuid references public.contab_contas(id) on delete set null,
  conta_credito_id uuid references public.contab_contas(id) on delete set null,
  historico text,
  ordem int not null default 0,
  atualizado_em timestamptz not null default now(),
  unique (empresa_id, codigo)
);

create table if not exists public.contab_fech_config (
  empresa_id uuid primary key references public.empresas(id) on delete cascade,
  vinculos text[] not null default array['clt', 'aprendiz'],      -- quem entra na base das provisões de folha
  tolerancia numeric(14,2) not null default 1 check (tolerancia >= 0),
  -- leiaute do arquivo do Domínio (montado na tela)
  dom_separador text not null default ';' check (dom_separador in (';', ',', '|', 'tab')),
  dom_data text not null default 'dd/mm/aaaa' check (dom_data in ('dd/mm/aaaa', 'aaaa-mm-dd', 'ddmmaaaa')),
  dom_decimal text not null default ',' check (dom_decimal in (',', '.')),
  dom_conta text not null default 'codigo' check (dom_conta in ('codigo', 'classificacao')),
  dom_campos text[] not null default array['data', 'debito', 'credito', 'valor', 'historico_codigo', 'complemento'],
  dom_historico_codigo text,
  dom_cabecalho boolean not null default false,
  dom_origens text[] not null default array['financeiro', 'folha', 'apuracao', 'depreciacao', 'manual', 'nota', 'fidc', 'estoque'],
  atualizado_em timestamptz not null default now()
);

create table if not exists public.contab_fech_meses (
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  mes date not null check (mes = date_trunc('month', mes)::date),
  situacao text not null default 'aberto' check (situacao in ('aberto', 'fechado')),
  observacao text,
  fechado_por uuid, fechado_em timestamptz,
  exportado_em timestamptz, exportado_por uuid,
  primary key (empresa_id, mes)
);

create table if not exists public.contab_fech_gerados (
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  mes date not null,
  regra_id uuid not null references public.contab_fech_regras(id) on delete cascade,
  lancamento_id uuid not null references public.contab_lancamentos(id) on delete cascade,
  valor numeric(14,2) not null,
  valor_sugerido numeric(14,2),
  gerado_por uuid default auth.uid(),
  gerado_em timestamptz not null default now(),
  primary key (empresa_id, mes, regra_id)
);

create or replace function public.cfech_pode(p_empresa uuid) returns boolean language sql stable security definer set search_path = public as $$
  select public.papel_em(p_empresa) in ('admin', 'diretor', 'financeiro')
$$;
create or replace function public.cfech_grava(p_empresa uuid) returns boolean language sql stable security definer set search_path = public as $$
  select public.papel_em(p_empresa) in ('admin', 'financeiro')
$$;

alter table public.contab_fech_regras enable row level security;
alter table public.contab_fech_config enable row level security;
alter table public.contab_fech_meses enable row level security;
alter table public.contab_fech_gerados enable row level security;
do $$ declare t text; begin
  foreach t in array array['contab_fech_regras', 'contab_fech_config', 'contab_fech_meses', 'contab_fech_gerados'] loop
    execute format('drop policy if exists %1$s_sel on public.%1$s', t);
    execute format('create policy %1$s_sel on public.%1$s for select to authenticated using (public.cfech_pode(empresa_id))', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
  foreach t in array array['contab_fech_regras', 'contab_fech_config'] loop
    execute format('drop policy if exists %1$s_ins on public.%1$s', t);
    execute format('create policy %1$s_ins on public.%1$s for insert to authenticated with check (public.is_admin(empresa_id))', t);
    execute format('drop policy if exists %1$s_upd on public.%1$s', t);
    execute format('create policy %1$s_upd on public.%1$s for update to authenticated using (public.is_admin(empresa_id)) with check (public.is_admin(empresa_id))', t);
    execute format('drop policy if exists %1$s_del on public.%1$s', t);
    execute format('create policy %1$s_del on public.%1$s for delete to authenticated using (public.is_admin(empresa_id))', t);
    execute format('grant insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;
drop trigger if exists zz_auditoria on public.contab_fech_regras;
create trigger zz_auditoria after insert or update or delete on public.contab_fech_regras for each row execute function public._auditar();
drop trigger if exists zz_auditoria on public.contab_fech_config;
create trigger zz_auditoria after insert or update or delete on public.contab_fech_config for each row execute function public._auditar();

-- regras padrão (sem contas: a tela pede as contas antes de gerar)
create or replace function public._cfech_padrao(p_empresa uuid) returns void language sql security definer set search_path = public as $$
  insert into contab_fech_regras(empresa_id, codigo, nome, tipo, percentual, historico, ordem) values
    (p_empresa, 'decimo', 'Provisão de 13º salário', 'decimo', 8.3333, 'Provisão de 13º salário do mês', 10),
    (p_empresa, 'ferias', 'Provisão de férias + 1/3', 'ferias', 11.1111, 'Provisão de férias e 1/3 do mês', 20),
    (p_empresa, 'encargos', 'Encargos sobre as provisões (INSS e FGTS)', 'encargos', null, 'Encargos sobre provisões de 13º e férias', 30),
    (p_empresa, 'icms', 'ICMS a recolher (apuração fechada)', 'icms', null, 'ICMS apurado no mês', 40),
    (p_empresa, 'ipi', 'IPI a recolher (apuração fechada)', 'ipi', null, 'IPI apurado no mês', 50),
    (p_empresa, 'pis_cofins', 'PIS e COFINS a recolher (apuração fechada)', 'pis_cofins', null, 'PIS e COFINS apurados no mês', 60),
    (p_empresa, 'feef_fecep', 'FEEF, AD/DIPER e FECEP (apuração fechada)', 'feef_fecep', null, 'FEEF, AD/DIPER e FECEP do mês', 70)
  on conflict (empresa_id, codigo) do nothing;
  insert into contab_fech_config(empresa_id) values (p_empresa) on conflict do nothing;
$$;

-- ------------------------------------------------------------------ sugestões do mês
create or replace function public.contab_fech_sugestoes(p_empresa uuid, p_mes date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_ini date := date_trunc('month', p_mes)::date; v_fim date := (date_trunc('month', p_mes) + interval '1 month - 1 day')::date;
  cfg contab_fech_config; v_folha numeric; v_qtd int; v_ap fisc_apuracoes; v_rh rh_parametros; v_prov numeric := 0; r record; v_val numeric; v_base text; v_aviso text;
  v_out jsonb := '[]'; g contab_fech_gerados;
begin
  if not public.cfech_pode(p_empresa) then raise exception 'Sem acesso ao fechamento contábil'; end if;
  select * into cfg from contab_fech_config where empresa_id = p_empresa;
  select coalesce(sum(salario), 0), count(*) into v_folha, v_qtd from rh_colaboradores
   where empresa_id = p_empresa and vinculo = any(coalesce(cfg.vinculos, array['clt', 'aprendiz'])) and situacao <> 'desligado'
     and coalesce(admissao, v_ini) <= v_fim and (demissao is null or demissao > v_fim);
  select * into v_ap from fisc_apuracoes where empresa_id = p_empresa and mes = v_ini;
  select * into v_rh from rh_parametros where empresa_id = p_empresa;
  for r in select * from contab_fech_regras where empresa_id = p_empresa and ativo order by ordem, nome loop
    v_val := null; v_aviso := null; v_base := null;
    if r.tipo in ('decimo', 'ferias') then
      v_val := round(v_folha * coalesce(r.percentual, 0) / 100, 2); v_prov := v_prov + v_val;
      v_base := format('%s%% de %s em salários (%s pessoa(s))', trim(to_char(coalesce(r.percentual, 0), 'FM9990D0999')), to_char(v_folha, 'FM999G999G990D00'), v_qtd);
      if v_qtd = 0 then v_aviso := 'Nenhum colaborador na base (RH › Colaboradores)'; end if;
    elsif r.tipo = 'encargos' then
      v_val := round(v_prov * coalesce(r.percentual, coalesce(v_rh.inss_pct, 0) + coalesce(v_rh.fgts_pct, 0)) / 100, 2);
      v_base := format('%s%% sobre as provisões de %s', trim(to_char(coalesce(r.percentual, coalesce(v_rh.inss_pct, 0) + coalesce(v_rh.fgts_pct, 0)), 'FM9990D0999')), to_char(v_prov, 'FM999G999G990D00'));
      if r.percentual is null and v_rh.inss_pct is null and v_rh.fgts_pct is null then v_aviso := 'Informe o percentual ou o INSS/FGTS nos parâmetros do RH'; end if;
    elsif r.tipo in ('icms', 'ipi', 'pis_cofins', 'feef_fecep') then
      if v_ap.situacao is distinct from 'fechada' then v_aviso := 'Feche a apuração de impostos do mês (CPD › Fiscal › Apuração)';
      else
        v_val := case r.tipo when 'icms' then (v_ap.resultado -> 'icms' ->> 'recolher')::numeric when 'ipi' then (v_ap.resultado -> 'ipi' ->> 'recolher')::numeric
          when 'pis_cofins' then (v_ap.resultado -> 'pc' ->> 'recolher')::numeric
          else coalesce((v_ap.resultado -> 'icms' ->> 'feef')::numeric, 0) + coalesce((v_ap.resultado -> 'icms' ->> 'adDiper')::numeric, 0) + coalesce((v_ap.resultado -> 'icms' ->> 'fecep')::numeric, 0) end;
        v_val := round(coalesce(v_val, 0), 2); v_base := 'apuração fechada em ' || to_char(v_ap.fechada_em at time zone 'America/Recife', 'DD/MM/YYYY');
      end if;
    else
      v_val := r.valor_fixo; v_base := 'valor fixo do mês';
    end if;
    if r.conta_debito_id is null or r.conta_credito_id is null then v_aviso := coalesce(v_aviso || ' · ', '') || 'Escolha as contas de débito e crédito'; end if;
    select * into g from contab_fech_gerados where empresa_id = p_empresa and mes = v_ini and regra_id = r.id;
    v_out := v_out || jsonb_build_object('regra_id', r.id, 'codigo', r.codigo, 'nome', r.nome, 'tipo', r.tipo, 'valor', v_val, 'base', v_base, 'aviso', v_aviso,
      'conta_debito_id', r.conta_debito_id, 'conta_credito_id', r.conta_credito_id, 'historico', r.historico,
      'gerado', g.lancamento_id is not null, 'lancamento_id', g.lancamento_id, 'valor_gerado', g.valor, 'gerado_em', g.gerado_em);
  end loop;
  return v_out;
end $$;

-- ------------------------------------------------------------------ gerar e desfazer
create or replace function public._cfech_aberto(p_empresa uuid, p_mes date) returns void language plpgsql stable as $$
begin
  if exists (select 1 from contab_fech_meses where empresa_id = p_empresa and mes = date_trunc('month', p_mes)::date and situacao = 'fechado') then
    raise exception 'Fechamento contábil de % já fechado: reabra antes', to_char(p_mes, 'MM/YYYY');
  end if;
end $$;

-- p_itens: [{ "regra_id": uuid, "valor": numeric }] — o valor pode ser o sugerido ou o ajustado na tela
create or replace function public.contab_fech_gerar(p_empresa uuid, p_mes date, p_itens jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_ini date := date_trunc('month', p_mes)::date; v_fim date := (date_trunc('month', p_mes) + interval '1 month - 1 day')::date;
  it jsonb; r contab_fech_regras; v_val numeric; v_lanc uuid; v_sug numeric; n int := 0; S jsonb;
begin
  if not public.cfech_grava(p_empresa) then raise exception 'Só o administrador e o financeiro geram os lançamentos do fechamento'; end if;
  perform public._cfech_aberto(p_empresa, v_ini);
  S := public.contab_fech_sugestoes(p_empresa, v_ini);
  for it in select * from jsonb_array_elements(coalesce(p_itens, '[]')) loop
    select * into r from contab_fech_regras where id = (it ->> 'regra_id')::uuid and empresa_id = p_empresa;
    if r.id is null then raise exception 'Regra não encontrada'; end if;
    if r.conta_debito_id is null or r.conta_credito_id is null then raise exception '%: escolha as contas de débito e crédito', r.nome; end if;
    if r.conta_debito_id = r.conta_credito_id then raise exception '%: débito e crédito na mesma conta', r.nome; end if;
    v_val := round(coalesce((it ->> 'valor')::numeric, 0), 2);
    select (x ->> 'valor')::numeric into v_sug from jsonb_array_elements(S) x where x ->> 'regra_id' = r.id::text;
    -- refaz: apaga o gerado antes
    delete from contab_lancamentos where id in (select lancamento_id from contab_fech_gerados where empresa_id = p_empresa and mes = v_ini and regra_id = r.id);
    delete from contab_fech_gerados where empresa_id = p_empresa and mes = v_ini and regra_id = r.id;
    if v_val <= 0 then continue; end if;
    insert into contab_lancamentos(empresa_id, data, historico, origem, origem_id)
      values (p_empresa, v_fim, coalesce(r.historico, r.nome) || ' — ' || to_char(v_ini, 'MM/YYYY'),
              case when r.tipo in ('decimo', 'ferias', 'encargos') then 'folha' when r.tipo = 'fixo' then 'manual' else 'apuracao' end, r.id)
      returning id into v_lanc;
    insert into contab_partidas(lancamento_id, conta_id, debito, credito) values (v_lanc, r.conta_debito_id, v_val, 0), (v_lanc, r.conta_credito_id, 0, v_val);
    insert into contab_fech_gerados(empresa_id, mes, regra_id, lancamento_id, valor, valor_sugerido) values (p_empresa, v_ini, r.id, v_lanc, v_val, v_sug);
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.contab_fech_desfazer(p_empresa uuid, p_mes date, p_regra uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_ini date := date_trunc('month', p_mes)::date;
begin
  if not public.cfech_grava(p_empresa) then raise exception 'Sem permissão'; end if;
  perform public._cfech_aberto(p_empresa, v_ini);
  delete from contab_lancamentos where id in (select lancamento_id from contab_fech_gerados where empresa_id = p_empresa and mes = v_ini and regra_id = p_regra);
  delete from contab_fech_gerados where empresa_id = p_empresa and mes = v_ini and regra_id = p_regra;
end $$;

-- ------------------------------------------------------------------ conferência: contas bancárias do balancete × saldo do fluxo
-- fonte do balancete: o importado da contabilidade com fim no último dia do mês; sem ele, o balancete gerado pela plataforma
create or replace function public.contab_fech_conferencia(p_empresa uuid, p_mes date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_ini date := date_trunc('month', p_mes)::date; v_fim date := (date_trunc('month', p_mes) + interval '1 month - 1 day')::date;
  v_bal uuid; v_fonte text; v_tol numeric; v_out jsonb;
begin
  if not public.cfech_pode(p_empresa) then raise exception 'Sem acesso ao fechamento contábil'; end if;
  select coalesce(tolerancia, 1) into v_tol from contab_fech_config where empresa_id = p_empresa; v_tol := coalesce(v_tol, 1);
  select id into v_bal from contab_balancetes where empresa_id = p_empresa and data_fim = v_fim order by importado_em desc limit 1;
  v_fonte := case when v_bal is not null then 'importado' else 'plataforma' end;
  with fluxo as (select s.conta_id, s.nome, s.saldo_pago from public.saldos_contas(p_empresa, v_fim) s),
  contab as (
    select bi.conta_id, bi.saldo_atual from contab_balancete_itens bi where bi.balancete_id = v_bal
    union all
    select g.conta_id, g.saldo_atual from public.contab_balancete_gerencial(p_empresa, v_ini, v_fim) g where v_bal is null
  ),
  linhas as (
    select f.conta_id, f.nome, round(f.saldo_pago, 2) fluxo, cc.classificacao, cc.descricao conta_contabil,
           round(coalesce((select sum(saldo_atual) from contab x where x.conta_id in (d.conta_id, d.conta_negativa_id)), 0), 2) contabil,
           d.conta_id is not null mapeada
      from fluxo f left join contab_depara_conta d on d.conta_bancaria_id = f.conta_id left join contab_contas cc on cc.id = d.conta_id
  )
  select jsonb_build_object('fonte', v_fonte, 'balancete_id', v_bal, 'tolerancia', v_tol, 'contas', coalesce(jsonb_agg(jsonb_build_object(
      'conta_id', conta_id, 'nome', nome, 'fluxo', fluxo, 'contabil', contabil, 'classificacao', classificacao, 'conta_contabil', conta_contabil, 'mapeada', mapeada,
      'diferenca', round(contabil - fluxo, 2), 'ok', mapeada and abs(contabil - fluxo) <= v_tol) order by nome), '[]'))
    into v_out from linhas;
  return v_out;
end $$;

-- ------------------------------------------------------------------ resumo e fechamento do mês
create or replace function public.contab_fech_resumo(p_empresa uuid, p_mes date) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_ini date := date_trunc('month', p_mes)::date; v_fim date := (date_trunc('month', p_mes) + interval '1 month - 1 day')::date; m contab_fech_meses; v jsonb;
begin
  if not public.cfech_pode(p_empresa) then raise exception 'Sem acesso ao fechamento contábil'; end if;
  if public.cfech_grava(p_empresa) and not exists (select 1 from contab_fech_regras where empresa_id = p_empresa) then perform public._cfech_padrao(p_empresa); end if;
  select * into m from contab_fech_meses where empresa_id = p_empresa and mes = v_ini;
  select jsonb_build_object('situacao', coalesce(m.situacao, 'aberto'), 'fechado_em', m.fechado_em, 'exportado_em', m.exportado_em, 'observacao', m.observacao,
    'lancamentos', (select count(*) from contab_lancamentos where empresa_id = p_empresa and data between v_ini and v_fim),
    'por_origem', (select coalesce(jsonb_object_agg(origem, q), '{}') from (select origem, count(*) q from contab_lancamentos where empresa_id = p_empresa and data between v_ini and v_fim group by origem) o),
    'depreciacao', exists (select 1 from contab_lancamentos where empresa_id = p_empresa and origem = 'depreciacao' and data between v_ini and v_fim),
    'apuracao_fechada', exists (select 1 from fisc_apuracoes where empresa_id = p_empresa and mes = v_ini and situacao = 'fechada'),
    'balancete_importado', exists (select 1 from contab_balancetes where empresa_id = p_empresa and data_fim = v_fim),
    'sem_partidas_fechando', (select count(*) from (select l.id from contab_lancamentos l join contab_partidas p on p.lancamento_id = l.id
        where l.empresa_id = p_empresa and l.data between v_ini and v_fim group by l.id having abs(sum(p.debito) - sum(p.credito)) > 0.005) z))
    into v;
  return v;
end $$;

create or replace function public.contab_fech_situacao(p_empresa uuid, p_mes date, p_fechar boolean, p_obs text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_ini date := date_trunc('month', p_mes)::date;
begin
  if p_fechar and not public.cfech_grava(p_empresa) then raise exception 'Só o administrador e o financeiro fecham o mês contábil'; end if;
  if not p_fechar and not public.is_admin(p_empresa) then raise exception 'Só o administrador reabre o mês contábil'; end if;
  insert into contab_fech_meses(empresa_id, mes, situacao, observacao, fechado_por, fechado_em)
    values (p_empresa, v_ini, case when p_fechar then 'fechado' else 'aberto' end, p_obs, case when p_fechar then auth.uid() end, case when p_fechar then now() end)
  on conflict (empresa_id, mes) do update set situacao = excluded.situacao, observacao = coalesce(excluded.observacao, contab_fech_meses.observacao),
    fechado_por = excluded.fechado_por, fechado_em = excluded.fechado_em;
end $$;

create or replace function public.contab_fech_exportado(p_empresa uuid, p_mes date) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.cfech_pode(p_empresa) then raise exception 'Sem acesso'; end if;
  insert into contab_fech_meses(empresa_id, mes, exportado_em, exportado_por) values (p_empresa, date_trunc('month', p_mes)::date, now(), auth.uid())
  on conflict (empresa_id, mes) do update set exportado_em = now(), exportado_por = auth.uid();
end $$;

do $$ declare f text; begin
  foreach f in array array['contab_fech_sugestoes(uuid, date)', 'contab_fech_gerar(uuid, date, jsonb)', 'contab_fech_desfazer(uuid, date, uuid)', 'contab_fech_conferencia(uuid, date)',
    'contab_fech_resumo(uuid, date)', 'contab_fech_situacao(uuid, date, boolean, text)', 'contab_fech_exportado(uuid, date)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  execute 'revoke all on function public._cfech_padrao(uuid) from public, anon, authenticated';
end $$;

comment on table public.contab_fech_regras is 'Fechamento contábil assistido: regras das provisões do mês e contas (melhoria 9.3)';

-- =====================================================================
-- Melhoria contínua 2.4 — Painel da Diretoria (07/11/2026)
-- Uma página com caixa, faturamento, margem, produção, perdas, qualidade, entregas e recuperação judicial: cada indicador
-- com a meta do ano, a situação (atingiu / atenção / abaixo), a tendência de 13 meses e o link para o detalhe.
-- Comentário do responsável por indicador e por mês, que vai para o PDF da reunião mensal (padrão de relatório à Diretoria).
-- Metas e parâmetros (contas do plano da RJ, valor mensal previsto, setores da produção, tolerância) numa tela.
-- Os indicadores financeiros (caixa e margem) são montados na tela com a DRE Gerencial; aqui ficam os operacionais.
-- Migração ADITIVA.
-- =====================================================================

create table if not exists public.diretoria_config (
  empresa_id uuid primary key references public.empresas(id) on delete cascade,
  tolerancia_pct numeric(5,2) not null default 10 check (tolerancia_pct between 0 and 50),
  rj_planos uuid[] not null default '{}',
  rj_previsto numeric(14,2) not null default 0 check (rj_previsto >= 0),
  rj_processo text,
  rj_inicio date,                          -- 1º mês de pagamento do plano (antes dele não há meta de RJ)
  producao_setores uuid[],                 -- null = todos os setores
  caixa_contas uuid[],                     -- null = todas, menos as de bloqueio judicial
  ocultos text[] not null default '{}',    -- indicadores escondidos do painel
  atualizado_por text default (auth.jwt() ->> 'email'), atualizado_em timestamptz not null default now()
);
create table if not exists public.diretoria_metas (
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  indicador text not null check (indicador in ('caixa', 'faturamento', 'margem', 'producao', 'perdas', 'qualidade', 'entregas', 'rj')),
  ano int not null check (ano between 2020 and 2100),
  meta numeric(16,2) not null,
  atualizado_por text default (auth.jwt() ->> 'email'), atualizado_em timestamptz not null default now(),
  primary key (empresa_id, indicador, ano)
);
create table if not exists public.diretoria_comentarios (
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  mes date not null,                       -- 1º dia do mês
  indicador text not null,
  texto text not null check (length(texto) between 1 and 2000),
  autor text default (auth.jwt() ->> 'email'), atualizado_em timestamptz not null default now(),
  primary key (empresa_id, mes, indicador)
);

-- quem pode alterar metas e parâmetros: administrador e diretor; comentar: também o financeiro
create or replace function public._dir_pode(p_empresa uuid, p_papeis text[]) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from membros where empresa_id = p_empresa and user_id = auth.uid() and papel::text = any (p_papeis));
$$;

alter table public.diretoria_config enable row level security;
alter table public.diretoria_metas enable row level security;
alter table public.diretoria_comentarios enable row level security;
do $$ declare t text; begin
  foreach t in array array['diretoria_config', 'diretoria_metas', 'diretoria_comentarios'] loop
    execute format('drop policy if exists %1$s_sel on public.%1$s; drop policy if exists %1$s_ins on public.%1$s; drop policy if exists %1$s_upd on public.%1$s; drop policy if exists %1$s_del on public.%1$s', t);
    execute format('create policy %1$s_sel on public.%1$s for select to authenticated using (public.is_membro(empresa_id))', t);
  end loop;
end $$;
create policy diretoria_config_ins on public.diretoria_config for insert to authenticated with check (public._dir_pode(empresa_id, array['admin', 'diretor']));
create policy diretoria_config_upd on public.diretoria_config for update to authenticated using (public._dir_pode(empresa_id, array['admin', 'diretor'])) with check (public._dir_pode(empresa_id, array['admin', 'diretor']));
create policy diretoria_metas_ins on public.diretoria_metas for insert to authenticated with check (public._dir_pode(empresa_id, array['admin', 'diretor']));
create policy diretoria_metas_upd on public.diretoria_metas for update to authenticated using (public._dir_pode(empresa_id, array['admin', 'diretor'])) with check (public._dir_pode(empresa_id, array['admin', 'diretor']));
create policy diretoria_metas_del on public.diretoria_metas for delete to authenticated using (public._dir_pode(empresa_id, array['admin', 'diretor']));
create policy diretoria_comentarios_ins on public.diretoria_comentarios for insert to authenticated with check (public._dir_pode(empresa_id, array['admin', 'diretor', 'financeiro']));
create policy diretoria_comentarios_upd on public.diretoria_comentarios for update to authenticated using (public._dir_pode(empresa_id, array['admin', 'diretor', 'financeiro'])) with check (public._dir_pode(empresa_id, array['admin', 'diretor', 'financeiro']));
create policy diretoria_comentarios_del on public.diretoria_comentarios for delete to authenticated using (public._dir_pode(empresa_id, array['admin', 'diretor', 'financeiro']));
grant select, insert, update, delete on public.diretoria_config, public.diretoria_metas, public.diretoria_comentarios to authenticated;

-- faturamento: +1 venda própria, −1 devolução de cliente, 0 o resto (mesma regra de js/lib/fat-relatorio.js)
create or replace function public._dir_fat_sinal(p_cfop text, p_propria boolean) returns int language sql immutable as $$
  select case
    when p_propria and left(p_cfop, 1) in ('5', '6', '7') and (substr(p_cfop, 2)::int between 101 and 125 or substr(p_cfop, 2) in ('401', '402', '403', '405', '501', '502')) then 1
    when p_propria and left(p_cfop, 1) in ('1', '2', '3') and substr(p_cfop, 2) in ('201', '202', '203', '204', '410', '411', '503', '504') then -1
    when not p_propria and left(p_cfop, 1) in ('5', '6', '7') and (substr(p_cfop, 2)::int between 201 and 210 or substr(p_cfop, 2) in ('410', '411', '412', '413', '553', '555', '556')) then -1
    else 0 end
  where p_cfop ~ '^[0-9]{4}$';
$$;

/** indicadores operacionais: 13 meses até o mês de referência */
create or replace function public.diretoria_operacional(p_empresa uuid, p_ref date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c diretoria_config; v_ini date := (date_trunc('month', p_ref) - interval '12 months')::date; v_fim date := (date_trunc('month', p_ref) + interval '1 month')::date;
        prazo int; r jsonb;
begin
  if not is_membro(p_empresa) then raise exception 'Sem acesso ao painel da diretoria.'; end if;
  select * into c from diretoria_config where empresa_id = p_empresa;
  prazo := coalesce((select dias_atraso from log_parametros where empresa_id = p_empresa limit 1), 3);
  with m as (select to_char(d, 'YYYY-MM') mes, d::date ini, (d + interval '1 month')::date fim from generate_series(v_ini, v_fim - 1, interval '1 month') d),
  fat as (
    select to_char(n.emissao, 'YYYY-MM') mes,
           sum(case when s = 1 then v else 0 end) venda, sum(case when s = -1 then v else 0 end) devolucao
      from (select n.emissao, _dir_fat_sinal(i.cfop, n.emissao_propria) s,
                   coalesce(i.vprod, 0) - coalesce(i.vdesc, 0) + coalesce(i.vfrete, 0) + coalesce(i.voutro, 0) + coalesce(i.v_ipi, 0) + coalesce(i.v_st, 0) v
              from nfe_notas n join nfe_itens i on i.nota_id = n.id
             where n.empresa_id = p_empresa and n.situacao = 'autorizada' and n.emissao >= v_ini and n.emissao < v_fim) n
     where s <> 0 group by 1),
  prod as (
    select to_char(a.inicio at time zone 'America/Recife', 'YYYY-MM') mes, sum(a.qtd_boa) boa, sum(a.refugo) refugo
      from prod_apontamentos a
     where a.empresa_id = p_empresa and a.inicio >= v_ini - 1 and a.inicio < v_fim + 1 and (c.producao_setores is null or a.setor_id = any (c.producao_setores))
     group by 1),
  rnc as (
    select m.mes,
           (select count(*) from qual_rnc x where x.empresa_id = p_empresa and x.situacao <> 'cancelada' and x.aberta_em >= m.ini and x.aberta_em < m.fim) abertas_mes,
           (select count(*) from qual_rnc x where x.empresa_id = p_empresa and x.situacao <> 'cancelada' and x.origem = 'cliente' and x.aberta_em >= m.ini and x.aberta_em < m.fim) cliente,
           (select count(*) from qual_rnc x where x.empresa_id = p_empresa and x.situacao <> 'cancelada' and x.aberta_em < m.fim and (x.encerrada_em is null or x.encerrada_em >= m.fim)) em_aberto,
           (select coalesce(sum(x.custo), 0) from qual_rnc x where x.empresa_id = p_empresa and x.situacao <> 'cancelada' and x.aberta_em >= m.ini and x.aberta_em < m.fim) custo
      from m),
  ent as (
    select to_char(g.data, 'YYYY-MM') mes, count(*) notas,
           count(*) filter (where cn.situacao = 'entregue') entregues,
           count(*) filter (where cn.situacao = 'entregue' and cn.entregue_em is not null and n.emissao is not null) medidas,
           count(*) filter (where cn.situacao = 'entregue' and cn.entregue_em is not null and n.emissao is not null and (cn.entregue_em at time zone 'America/Recife')::date - n.emissao <= prazo) no_prazo,
           count(*) filter (where cn.situacao in ('devolvida', 'nao_entregue')) problemas
      from log_carga_notas cn join log_cargas g on g.id = cn.carga_id left join nfe_notas n on n.id = cn.nota_id
     where cn.empresa_id = p_empresa and g.data >= v_ini and g.data < v_fim and coalesce(g.status, '') <> 'cancelada'
     group by 1),
  rj as (
    select to_char(l.data, 'YYYY-MM') mes, sum(abs(l.valor)) pago
      from lancamentos l
     where l.empresa_id = p_empresa and l.status = 'Pago' and l.data >= v_ini and l.data < v_fim and l.plano_id = any (coalesce(c.rj_planos, '{}'))
     group by 1)
  select jsonb_build_object(
    'meses', (select jsonb_agg(mes order by mes) from m),
    'fat_venda', (select jsonb_agg(coalesce(f.venda, 0) order by m.mes) from m left join fat f using (mes)),
    'fat_devolucao', (select jsonb_agg(coalesce(f.devolucao, 0) order by m.mes) from m left join fat f using (mes)),
    'prod_boa', (select jsonb_agg(coalesce(p.boa, 0) order by m.mes) from m left join prod p using (mes)),
    'prod_refugo', (select jsonb_agg(coalesce(p.refugo, 0) order by m.mes) from m left join prod p using (mes)),
    'rnc_mes', (select jsonb_agg(abertas_mes order by mes) from rnc),
    'rnc_cliente', (select jsonb_agg(cliente order by mes) from rnc),
    'rnc_em_aberto', (select jsonb_agg(em_aberto order by mes) from rnc),
    'rnc_custo', (select jsonb_agg(custo order by mes) from rnc),
    'ent_notas', (select jsonb_agg(coalesce(e.notas, 0) order by m.mes) from m left join ent e using (mes)),
    'ent_entregues', (select jsonb_agg(coalesce(e.entregues, 0) order by m.mes) from m left join ent e using (mes)),
    'ent_medidas', (select jsonb_agg(coalesce(e.medidas, 0) order by m.mes) from m left join ent e using (mes)),
    'ent_no_prazo', (select jsonb_agg(coalesce(e.no_prazo, 0) order by m.mes) from m left join ent e using (mes)),
    'ent_problemas', (select jsonb_agg(coalesce(e.problemas, 0) order by m.mes) from m left join ent e using (mes)),
    'rj_pago', (select jsonb_agg(coalesce(j.pago, 0) order by m.mes) from m left join rj j using (mes)),
    'prazo_entrega_dias', prazo,
    'meta_prazo_logistica', (select (metas ->> 'prazo_pct')::numeric from log_parametros where empresa_id = p_empresa limit 1)
  ) into r;
  return r;
end $$;
revoke all on function public.diretoria_operacional(uuid, date) from public, anon;
grant execute on function public.diretoria_operacional(uuid, date) to authenticated;
revoke all on function public._dir_pode(uuid, text[]) from public, anon;
grant execute on function public._dir_pode(uuid, text[]) to authenticated;

-- conferência: tabelas = 3, função = 1
select (select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('diretoria_config', 'diretoria_metas', 'diretoria_comentarios')) as tabelas,
       (select count(*) from pg_proc where proname = 'diretoria_operacional') as funcao;

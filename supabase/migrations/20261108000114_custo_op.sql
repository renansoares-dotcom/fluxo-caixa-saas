-- =====================================================================
-- Melhoria contínua 6.3 — Custo real da OP (08/11/2026)
-- Custo real de cada ordem de produção, contra o custo orçado pela estrutura do produto, e a margem pelo preço de venda:
--   material   = consumos apontados × custo médio do estoque (sem custo médio: último preço de compra do de-para)
--   tinta      = ordens da Casa de Tintas ligadas à OP (custo/kg × entregue − retorno; sem entrega, o custo da ordem)
--   máquina    = horas apontadas × custo-hora (da máquina › do setor › padrão da empresa)
--   manutenção = custo das OS concluídas no mês na máquina (terceiros + peças + horas) rateado pelas horas apontadas
--   orçado     = estrutura do produto × quantidade (com a perda) + horas previstas das etapas × custo-hora
--   receita    = preço médio das NF-e de venda do produto nos N dias antes da conclusão × quantidade boa
-- Parâmetros (prod_custo_config) e custo-hora por máquina e setor ficam na tela. Migração ADITIVA.
-- =====================================================================
alter table public.prod_maquinas add column if not exists custo_hora numeric(12,2) check (custo_hora is null or custo_hora >= 0);
alter table public.prod_setores add column if not exists custo_hora numeric(12,2) check (custo_hora is null or custo_hora >= 0);

create table if not exists public.prod_custo_config (
  empresa_id uuid primary key references public.empresas(id) on delete cascade,
  custo_hora_padrao numeric(12,2) not null default 0 check (custo_hora_padrao >= 0),
  ratear_manutencao boolean not null default true,
  dias_preco smallint not null default 90 check (dias_preco between 7 and 365),     -- janela do preço médio de venda
  tolerancia_pct numeric(5,2) not null default 10 check (tolerancia_pct between 0 and 100), -- desvio real × orçado aceito
  margem_minima_pct numeric(5,2) not null default 15 check (margem_minima_pct between -100 and 100),
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid default auth.uid()
);
alter table public.prod_custo_config enable row level security;
drop policy if exists prod_custo_config_sel on public.prod_custo_config;
drop policy if exists prod_custo_config_ins on public.prod_custo_config;
drop policy if exists prod_custo_config_upd on public.prod_custo_config;
create policy prod_custo_config_sel on public.prod_custo_config for select to authenticated using (public.is_membro(empresa_id));
create policy prod_custo_config_ins on public.prod_custo_config for insert to authenticated with check (public.pode_editar(empresa_id));
create policy prod_custo_config_upd on public.prod_custo_config for update to authenticated using (public.pode_editar(empresa_id)) with check (public.pode_editar(empresa_id));
grant select, insert, update on public.prod_custo_config to authenticated;
drop trigger if exists zz_auditoria on public.prod_custo_config;
create trigger zz_auditoria after insert or update or delete on public.prod_custo_config for each row execute function public._auditar();

-- custo unitário de um produto: custo médio do estoque › último preço de compra do de-para › zero
create or replace function public._custo_unit(p_produto uuid)
returns table(custo numeric, fonte text) language sql stable security definer set search_path = public as $$
  select coalesce(nullif(c.custo_medio, 0), f.ultimo_preco, 0),
         case when nullif(c.custo_medio, 0) is not null then 'custo médio' when f.ultimo_preco is not null then 'última compra' else 'sem custo' end
    from (select p_produto id) x
    left join est_custos c on c.produto_id = x.id
    left join lateral (select ultimo_preco from produto_fornecedores where produto_id = x.id and ultimo_preco is not null order by ultima_compra desc nulls last limit 1) f on true
$$;

-- custo detalhado de uma OP
create or replace function public.prod_custo_op(p_ordem uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  o prod_ordens; cfg prod_custo_config; v_out jsonb; v_ref date; v_bom numeric; v_ref_kg numeric;
begin
  select * into o from prod_ordens where id = p_ordem;
  if o.id is null then raise exception 'OP não encontrada.'; end if;
  if not public.is_membro(o.empresa_id) then raise exception 'Sem permissão.'; end if;
  select * into cfg from prod_custo_config where empresa_id = o.empresa_id;
  v_ref := coalesce(o.concluida_em::date, current_date);
  select coalesce(sum(qtd_boa), 0), coalesce(sum(refugo), 0) into v_bom, v_ref_kg from prod_apontamentos a
   where a.ordem_id = o.id and (a.etapa_id is null or a.etapa_id = (select id from prod_ordem_etapas where ordem_id = o.id order by seq desc limit 1));
  with mat as (
    select c.produto_id, coalesce(p.codigo, c.codigo) codigo, p.descricao, sum(c.quantidade) qtd, cu.custo, cu.fonte
      from prod_consumos c left join produtos p on p.id = c.produto_id
      left join lateral public._custo_unit(c.produto_id) cu on true
     where c.ordem_id = o.id group by 1, 2, 3, 5, 6
  ), tin as (
    select t.numero, co.nome cor, t.quantidade_real, t.entregue_kg, t.retorno_kg,
           case when coalesce(t.entregue_kg, 0) > 0 and t.custo_kg is not null then round(t.custo_kg * greatest(t.entregue_kg - coalesce(t.retorno_kg, 0), 0), 2)
                else coalesce(t.custo_total, 0) end valor
      from tin_ordens t left join tin_cores co on co.id = t.cor_id
     where t.ordem_id = o.id and t.situacao <> 'cancelada'
  ), maq as (
    select a.maquina_id, m.codigo, m.nome, a.setor_id, s.nome setor,
           sum(extract(epoch from (coalesce(a.fim, now()) - a.inicio)) / 3600) horas,
           coalesce(m.custo_hora, s.custo_hora, cfg.custo_hora_padrao, 0) custo_hora
      from prod_apontamentos a left join prod_maquinas m on m.id = a.maquina_id left join prod_setores s on s.id = coalesce(a.setor_id, m.setor_id)
     where a.ordem_id = o.id group by 1, 2, 3, 4, 5, 7
  ), man as (
    -- custo de manutenção por hora de cada máquina no mês de cada apontamento × horas da OP naquele mês
    select a.maquina_id, date_trunc('month', a.inicio)::date mes, sum(extract(epoch from (coalesce(a.fim, now()) - a.inicio)) / 3600) horas_op
      from prod_apontamentos a where a.ordem_id = o.id and a.maquina_id is not null and coalesce(cfg.ratear_manutencao, true) group by 1, 2
  ), man2 as (
    select man.*, (
        select coalesce(sum(coalesce(os.valor_terceiros, 0)
                 + coalesce((select sum(pc.custo) from man_os_pecas pc where pc.ordem_id = os.id and pc.situacao = 'consumida'), 0)
                 + coalesce((select sum(h.horas * coalesce(h.custo_hora, 0)) from man_os_horas h where h.ordem_id = os.id), 0)), 0)
          from man_ordens os join man_equipamentos e on e.id = os.equipamento_id
         where e.maquina_id = man.maquina_id and os.situacao = 'concluida' and date_trunc('month', coalesce(os.fim, os.atualizado_em))::date = man.mes) custo_mes,
      (select sum(extract(epoch from (coalesce(a2.fim, now()) - a2.inicio)) / 3600) from prod_apontamentos a2
        where a2.maquina_id = man.maquina_id and date_trunc('month', a2.inicio)::date = man.mes) horas_mes
      from man
  ), orc_mat as (
    select e.componente_id, p.codigo, p.descricao, o.quantidade * e.quantidade / e.base * (1 + e.perda_pct / 100) qtd, cu.custo
      from produto_estrutura e join produtos p on p.id = e.componente_id left join lateral public._custo_unit(e.componente_id) cu on true
     where e.produto_id = o.produto_id
  ), orc_maq as (
    select et.setor_id, s.nome setor, et.maquina_id, coalesce(et.horas_previstas, 0) horas,
           coalesce(m.custo_hora, s.custo_hora, cfg.custo_hora_padrao, 0) custo_hora
      from prod_ordem_etapas et left join prod_setores s on s.id = et.setor_id left join prod_maquinas m on m.id = et.maquina_id
     where et.ordem_id = o.id
  ), venda as (
    select sum(i.vprod - coalesce(i.vdesc, 0)) valor, sum(i.qcom) qtd, count(distinct n.id) notas
      from nfe_itens i join nfe_notas n on n.id = i.nota_id
     where n.empresa_id = o.empresa_id and n.emissao_propria and n.tipo = 'saida' and n.situacao = 'autorizada'
       and coalesce(n.finalidade, '1') = '1' and i.cprod = coalesce((select codigo from produtos where id = o.produto_id), o.codigo_produto)
       and left(regexp_replace(coalesce(i.cfop, ''), '\D', '', 'g'), 1) in ('5', '6', '7')
       and n.emissao between v_ref - coalesce(cfg.dias_preco, 90) and v_ref
  )
  select jsonb_build_object(
    'ordem', jsonb_build_object('id', o.id, 'numero', o.numero, 'numero_iniflex', o.numero_iniflex, 'produto', coalesce(o.codigo_produto, '') || ' ' || coalesce(o.descricao, ''),
      'quantidade', o.quantidade, 'unidade', o.unidade, 'status', o.status, 'cliente', o.cliente, 'concluida_em', o.concluida_em, 'referencia', v_ref),
    'producao', jsonb_build_object('bom', v_bom, 'refugo', v_ref_kg),
    'material', (select coalesce(jsonb_agg(jsonb_build_object('codigo', codigo, 'descricao', descricao, 'qtd', round(qtd, 4), 'custo', round(custo, 6), 'fonte', fonte, 'valor', round(qtd * custo, 2)) order by qtd * custo desc), '[]'::jsonb) from mat),
    'tinta', (select coalesce(jsonb_agg(jsonb_build_object('numero', numero, 'cor', cor, 'kg', greatest(coalesce(entregue_kg, 0) - coalesce(retorno_kg, 0), 0), 'valor', valor)), '[]'::jsonb) from tin),
    'maquina', (select coalesce(jsonb_agg(jsonb_build_object('codigo', codigo, 'nome', nome, 'setor', setor, 'horas', round(horas, 2), 'custo_hora', custo_hora, 'valor', round(horas * custo_hora, 2))), '[]'::jsonb) from maq),
    'manutencao', (select coalesce(jsonb_agg(jsonb_build_object('maquina_id', maquina_id, 'mes', mes, 'horas_op', round(horas_op, 2), 'horas_mes', round(horas_mes, 2), 'custo_mes', custo_mes,
                    'valor', case when horas_mes > 0 then round(custo_mes * horas_op / horas_mes, 2) else 0 end)), '[]'::jsonb) from man2),
    'orcado', jsonb_build_object(
      'material', (select coalesce(jsonb_agg(jsonb_build_object('codigo', codigo, 'descricao', descricao, 'qtd', round(qtd, 4), 'custo', round(custo, 6), 'valor', round(qtd * custo, 2))), '[]'::jsonb) from orc_mat),
      'maquina', (select coalesce(jsonb_agg(jsonb_build_object('setor', setor, 'horas', horas, 'custo_hora', custo_hora, 'valor', round(horas * custo_hora, 2))), '[]'::jsonb) from orc_maq),
      'tem_estrutura', exists (select 1 from orc_mat)),
    'venda', (select jsonb_build_object('valor', valor, 'qtd', qtd, 'notas', notas, 'preco', case when qtd > 0 then round(valor / qtd, 6) end, 'dias', coalesce(cfg.dias_preco, 90)) from venda)
  ) into v_out;
  return v_out;
end $$;
revoke all on function public.prod_custo_op(uuid) from public, anon;
grant execute on function public.prod_custo_op(uuid) to authenticated;

-- resumo das OPs de um período (pela emissão; concluídas pela conclusão) para a lista
create or replace function public.prod_custo_ops(p_empresa uuid, p_de date, p_ate date)
returns setof jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_membro(p_empresa) then raise exception 'Sem permissão.'; end if;
  return query
    select public.prod_custo_op(o.id) from prod_ordens o
     where o.empresa_id = p_empresa and o.status <> 'cancelada'
       and coalesce(o.concluida_em::date, o.emissao) between p_de and p_ate
       and exists (select 1 from prod_apontamentos a where a.ordem_id = o.id)
     order by coalesce(o.concluida_em::date, o.emissao) desc, o.numero desc
     limit 500;
end $$;
revoke all on function public.prod_custo_ops(uuid, date, date) from public, anon;
grant execute on function public.prod_custo_ops(uuid, date, date) to authenticated;

-- conferência: 1 tabela e 2 funções
select (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'prod_custo_config') as tabela,
       (select count(*) from pg_proc where proname in ('prod_custo_op', 'prod_custo_ops')) as funcoes;

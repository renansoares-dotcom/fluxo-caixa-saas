-- =====================================================================
-- Melhoria contínua 6.7 — Previsão de tinta pela programação e reaproveitamento das sobras (08/11/2026)
--   • tin_produto_cores: as cores de cada produto (embalagem) e o consumo em gramas de tinta por kg de produto;
--     sem consumo cadastrado, vale a média real das últimas OPs (tinta entregue − retorno ÷ kg bons na impressão);
--   • tin_previsao(empresa): OPs abertas com a etapa de impressão nos próximos N dias × cores × consumo = kg por cor,
--     menos as sobras da mesma cor ainda na validade = kg a preparar; insumos da receita aprovada contra o saldo;
--     OPs sem ficha de cores; sobras sem uso previsto (vencendo primeiro);
--   • tin_previsao_config: horizonte, setor da impressão, quantas OPs entram na média e consumo padrão.
-- Migração ADITIVA.
-- =====================================================================
create table if not exists public.tin_produto_cores (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  produto_id uuid not null references public.produtos(id) on delete cascade,
  cor_id uuid not null references public.tin_cores(id) on delete cascade,
  receita_id uuid references public.tin_receitas(id) on delete set null,     -- vazio: a primeira receita aprovada da cor
  consumo_g_kg numeric(10,3) check (consumo_g_kg is null or consumo_g_kg > 0), -- vazio: a média real das OPs
  observacao text check (length(observacao) <= 300),
  unique (produto_id, cor_id)
);
alter table public.tin_produto_cores enable row level security;
drop policy if exists tin_produto_cores_sel on public.tin_produto_cores;
drop policy if exists tin_produto_cores_ins on public.tin_produto_cores;
drop policy if exists tin_produto_cores_upd on public.tin_produto_cores;
drop policy if exists tin_produto_cores_del on public.tin_produto_cores;
create policy tin_produto_cores_sel on public.tin_produto_cores for select to authenticated using (public.is_participante(empresa_id));
create policy tin_produto_cores_ins on public.tin_produto_cores for insert to authenticated with check (public.pode_tintas(empresa_id));
create policy tin_produto_cores_upd on public.tin_produto_cores for update to authenticated using (public.pode_tintas(empresa_id)) with check (public.pode_tintas(empresa_id));
create policy tin_produto_cores_del on public.tin_produto_cores for delete to authenticated using (public.pode_tintas(empresa_id));
grant select, insert, update, delete on public.tin_produto_cores to authenticated;
drop trigger if exists zz_auditoria on public.tin_produto_cores;
create trigger zz_auditoria after insert or update or delete on public.tin_produto_cores for each row execute function public._auditar();

create table if not exists public.tin_previsao_config (
  empresa_id uuid primary key references public.empresas(id) on delete cascade,
  horizonte_dias smallint not null default 14 check (horizonte_dias between 1 and 60),
  setor_impressao_id uuid references public.prod_setores(id) on delete set null,   -- vazio: o setor com "impress" no nome
  ops_media smallint not null default 10 check (ops_media between 1 and 50),
  consumo_padrao_g_kg numeric(10,3) not null default 0 check (consumo_padrao_g_kg >= 0),     -- 0: sem padrão (a OP fica "sem consumo")
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid default auth.uid()
);
alter table public.tin_previsao_config enable row level security;
drop policy if exists tin_previsao_config_sel on public.tin_previsao_config;
drop policy if exists tin_previsao_config_ins on public.tin_previsao_config;
drop policy if exists tin_previsao_config_upd on public.tin_previsao_config;
create policy tin_previsao_config_sel on public.tin_previsao_config for select to authenticated using (public.is_participante(empresa_id));
create policy tin_previsao_config_ins on public.tin_previsao_config for insert to authenticated with check (public.pode_pcp(empresa_id));
create policy tin_previsao_config_upd on public.tin_previsao_config for update to authenticated using (public.pode_pcp(empresa_id)) with check (public.pode_pcp(empresa_id));
grant select, insert, update on public.tin_previsao_config to authenticated;
drop trigger if exists zz_auditoria on public.tin_previsao_config;
create trigger zz_auditoria after insert or update or delete on public.tin_previsao_config for each row execute function public._auditar();

-- consumo real por produto × cor: média das últimas N OPs (tinta líquida entregue ÷ kg bons na impressão), em g/kg
create or replace function public.tin_consumo_real(p_empresa uuid)
returns table(produto_id uuid, cor_id uuid, ops int, kg_tinta numeric, kg_produto numeric, g_kg numeric)
language plpgsql stable security definer set search_path = public as $$
declare v_set uuid; v_n int;
begin
  if not public.is_participante(p_empresa) then raise exception 'Sem permissão.'; end if;
  select setor_impressao_id, ops_media into v_set, v_n from tin_previsao_config where empresa_id = p_empresa;
  v_set := coalesce(v_set, (select id from prod_setores where empresa_id = p_empresa and semacento_lower(nome) like '%impress%' order by ordem limit 1));
  v_n := coalesce(v_n, 10);
  return query
  with t as (
    select o.produto_id, t.cor_id, t.ordem_id, sum(greatest(t.entregue_kg - t.retorno_kg, 0)) kg_t
      from tin_ordens t join prod_ordens o on o.id = t.ordem_id
     where t.empresa_id = p_empresa and t.situacao in ('entregue', 'encerrada') and o.produto_id is not null and o.status = 'concluida'
     group by 1, 2, 3
  ), p as (
    select t.*, (select coalesce(sum(e.qtd_boa), 0) from prod_ordem_etapas e where e.ordem_id = t.ordem_id and (v_set is null or e.setor_id = v_set)) kg_p,
           row_number() over (partition by t.produto_id, t.cor_id order by (select concluida_em from prod_ordens where id = t.ordem_id) desc) rn
      from t
  )
  select p.produto_id, p.cor_id, count(*)::int, round(sum(p.kg_t), 3), round(sum(p.kg_p), 3),
         case when sum(p.kg_p) > 0 then round(sum(p.kg_t) / sum(p.kg_p) * 1000, 3) end
    from p where p.rn <= v_n and p.kg_p > 0 group by 1, 2;
end $$;
revoke all on function public.tin_consumo_real(uuid) from public, anon;
grant execute on function public.tin_consumo_real(uuid) to authenticated;

create or replace function public.tin_previsao(p_empresa uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare cfg tin_previsao_config; v_set uuid; v_ate date; v_out jsonb;
begin
  if not public.is_participante(p_empresa) then raise exception 'Sem permissão.'; end if;
  select * into cfg from tin_previsao_config where empresa_id = p_empresa;
  v_set := coalesce(cfg.setor_impressao_id, (select id from prod_setores where empresa_id = p_empresa and semacento_lower(nome) like '%impress%' order by ordem limit 1));
  v_ate := current_date + coalesce(cfg.horizonte_dias, 14);
  with ops as (
    -- OPs abertas com a etapa de impressão (ou sem etapas, pela entrega) dentro do horizonte; quantidade que falta imprimir
    select o.id, o.numero, o.numero_iniflex, o.produto_id, trim(coalesce(o.codigo_produto, '') || ' ' || coalesce(o.descricao, '')) produto, o.cliente,
           coalesce(e.inicio_previsto, o.entrega - 3, current_date) data,
           greatest(coalesce(e.qtd_prevista, o.quantidade) - coalesce(e.qtd_boa, 0), 0) kg
      from prod_ordens o left join lateral (select * from prod_ordem_etapas x where x.ordem_id = o.id and (v_set is null or x.setor_id = v_set) order by seq limit 1) e on true
     where o.empresa_id = p_empresa and o.status in ('planejada', 'liberada', 'em_producao')
       and (e.id is not null or v_set is null) and coalesce(e.status, 'aguardando') <> 'concluida'
       and coalesce(e.inicio_previsto, o.entrega - 3, current_date) <= v_ate
  ), real as (select * from public.tin_consumo_real(p_empresa)
  ), nec as (
    select ops.*, pc.cor_id, pc.receita_id,
           coalesce(pc.consumo_g_kg, r.g_kg, nullif(cfg.consumo_padrao_g_kg, 0)) g_kg,
           case when pc.consumo_g_kg is not null then 'ficha' when r.g_kg is not null then 'média de ' || r.ops || ' OP(s)' when nullif(cfg.consumo_padrao_g_kg, 0) is not null then 'padrão' end fonte
      from ops join tin_produto_cores pc on pc.produto_id = ops.produto_id
      left join real r on r.produto_id = ops.produto_id and r.cor_id = pc.cor_id
  ), sob as (
    -- sobras: o que voltou da máquina, na validade, menos o que já foi pesado como ingrediente "sobra" do mesmo lote
    select t.id, t.numero, t.cor_id, t.lote_codigo, t.validade,
           greatest(t.retorno_kg - coalesce((select sum(p.pesada) from tin_pesagens p join tin_itens i on i.id = p.item_id
                                              where p.lote_id = t.lote_id and t.lote_id is not null and i.funcao = 'sobra' and p.situacao = 'pesada'), 0), 0) kg
      from tin_ordens t where t.empresa_id = p_empresa and t.retorno_kg > 0 and t.situacao in ('entregue', 'encerrada')
       and (t.validade is null or t.validade >= current_date)
  ), por_cor as (
    select n.cor_id, round(sum(n.kg * n.g_kg / 1000), 3) kg, min(n.data) primeira,
           jsonb_agg(jsonb_build_object('op', n.numero, 'numero_iniflex', n.numero_iniflex, 'produto', n.produto, 'cliente', n.cliente, 'data', n.data, 'kg_produto', round(n.kg, 1),
                     'g_kg', n.g_kg, 'fonte', n.fonte, 'kg_tinta', round(n.kg * n.g_kg / 1000, 3)) order by n.data) ops,
           (array_agg(n.receita_id) filter (where n.receita_id is not null))[1] receita_id
      from nec n where n.g_kg is not null group by 1
  ), cor as (
    select c.id cor_id, c.codigo, c.nome, c.hex, pc.kg necessidade, pc.primeira, pc.ops,
           coalesce((select sum(s.kg) from sob s where s.cor_id = c.id), 0) sobra,
           coalesce(pc.receita_id, (select r.id from tin_receitas r where r.cor_id = c.id and r.ativo and exists (select 1 from tin_versoes v where v.receita_id = r.id and v.situacao = 'aprovada') order by r.codigo limit 1)) receita_id
      from por_cor pc join tin_cores c on c.id = pc.cor_id
  ), ins as (
    -- insumos para preparar o que falta (necessidade − sobra), pela versão aprovada da receita
    select i.produto_id, sum(greatest(cor.necessidade - cor.sobra, 0) * i.quantidade / v.base_kg) qtd
      from cor join tin_versoes v on v.receita_id = cor.receita_id and v.situacao = 'aprovada'
      join tin_itens i on i.versao_id = v.id and i.funcao <> 'sobra'
     group by 1
  )
  select jsonb_build_object(
    'horizonte', coalesce(cfg.horizonte_dias, 14), 'ate', v_ate, 'setor_impressao_id', v_set,
    'cores', (select coalesce(jsonb_agg(jsonb_build_object('cor_id', cor.cor_id, 'codigo', cor.codigo, 'nome', cor.nome, 'hex', cor.hex, 'necessidade', cor.necessidade,
                'sobra', round(cor.sobra, 3), 'preparar', round(greatest(cor.necessidade - cor.sobra, 0), 3), 'primeira', cor.primeira, 'ops', cor.ops, 'tem_receita', cor.receita_id is not null,
                'sobras', (select coalesce(jsonb_agg(jsonb_build_object('ordem', s.numero, 'lote', s.lote_codigo, 'kg', round(s.kg, 3), 'validade', s.validade) order by s.validade nulls last), '[]'::jsonb) from sob s where s.cor_id = cor.cor_id and s.kg > 0))
                order by cor.primeira, cor.codigo), '[]'::jsonb) from cor),
    'insumos', (select coalesce(jsonb_agg(jsonb_build_object('produto_id', p.id, 'codigo', p.codigo, 'descricao', p.descricao, 'unidade', p.unidade, 'necessidade', round(ins.qtd, 3),
                'saldo', (select sum(s.quantidade) from est_saldos s where s.produto_id = p.id and exists (select 1 from est_config ec where ec.empresa_id = p_empresa and ec.implantado_em is not null)))
                order by ins.qtd desc), '[]'::jsonb) from ins join produtos p on p.id = ins.produto_id),
    'sem_ficha', (select coalesce(jsonb_agg(jsonb_build_object('op', ops.numero, 'produto', ops.produto, 'produto_id', ops.produto_id, 'data', ops.data, 'kg', round(ops.kg, 1)) order by ops.data), '[]'::jsonb)
                from ops where not exists (select 1 from tin_produto_cores pc where pc.produto_id = ops.produto_id)),
    'sem_consumo', (select coalesce(jsonb_agg(distinct jsonb_build_object('produto', n.produto, 'cor_id', n.cor_id)), '[]'::jsonb) from nec n where n.g_kg is null),
    'sobras_paradas', (select coalesce(jsonb_agg(jsonb_build_object('ordem', s.numero, 'cor', c.codigo || ' ' || c.nome, 'hex', c.hex, 'lote', s.lote_codigo, 'kg', round(s.kg, 3), 'validade', s.validade) order by s.validade nulls last), '[]'::jsonb)
                from sob s join tin_cores c on c.id = s.cor_id where s.kg > 0 and not exists (select 1 from por_cor pc where pc.cor_id = s.cor_id))
  ) into v_out;
  return v_out;
end $$;
revoke all on function public.tin_previsao(uuid) from public, anon;
grant execute on function public.tin_previsao(uuid) to authenticated;

-- conferência: 2 tabelas e 2 funções
select (select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('tin_produto_cores', 'tin_previsao_config')) as tabelas,
       (select count(*) from pg_proc where proname in ('tin_consumo_real', 'tin_previsao')) as funcoes;

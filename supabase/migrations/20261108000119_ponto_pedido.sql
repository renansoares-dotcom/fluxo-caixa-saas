-- =====================================================================
-- Melhoria contínua 5.4 — Ponto de pedido e estoque mínimo pelo consumo (08/11/2026)
-- Para cada material, pelo consumo real dos últimos N dias:
--   consumo médio diário (d) e variação (σ diário, pelas semanas)
--   estoque de segurança  = z × σ × √(prazo de entrega)            (z pelo nível de serviço: 90% 1,28 · 95% 1,65 · 98% 2,05 · 99% 2,33)
--   ponto de pedido       = d × prazo de entrega + estoque de segurança
--   estoque máximo        = ponto de pedido + d × intervalo entre compras
--   sugestão de compra    = máximo − saldo − pedidos em aberto, quando saldo + pedidos ≤ ponto de pedido
--   cobertura (dias) = saldo ÷ d · giro anual = consumo de 12 meses ÷ saldo · parado = dias sem saída
-- Consumo: saídas do Kardex (com o estoque implantado) ou, antes disso, as compras pelas NF-e de entrada (de-para).
-- Prazo de entrega: o do produto (novo campo) › média real (pedido → 1ª nota de entrada do fornecedor) › padrão.
-- Os valores calculados só vão para o cadastro quando alguém aplica (est_reposicao_aplicar). Migração ADITIVA.
-- =====================================================================
alter table public.produtos add column if not exists lead_time_dias smallint check (lead_time_dias is null or lead_time_dias between 0 and 365);
alter table public.produtos add column if not exists reposicao_calc_em timestamptz;   -- quando o mínimo e o ponto de pedido foram aplicados pelo cálculo

create table if not exists public.est_reposicao_config (
  empresa_id uuid primary key references public.empresas(id) on delete cascade,
  janela_dias smallint not null default 90 check (janela_dias between 30 and 365),
  nivel_servico numeric(4,1) not null default 95 check (nivel_servico in (90, 95, 98, 99)),
  lead_time_padrao smallint not null default 15 check (lead_time_padrao between 1 and 180),
  intervalo_compra_dias smallint not null default 15 check (intervalo_compra_dias between 1 and 180),
  parado_dias smallint not null default 90 check (parado_dias between 30 and 365),
  fonte text not null default 'auto' check (fonte in ('auto', 'kardex', 'compras')),
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid default auth.uid()
);
alter table public.est_reposicao_config enable row level security;
drop policy if exists est_reposicao_config_sel on public.est_reposicao_config;
drop policy if exists est_reposicao_config_ins on public.est_reposicao_config;
drop policy if exists est_reposicao_config_upd on public.est_reposicao_config;
create policy est_reposicao_config_sel on public.est_reposicao_config for select to authenticated using (public.is_participante(empresa_id));
create policy est_reposicao_config_ins on public.est_reposicao_config for insert to authenticated with check (public.pode_editar(empresa_id));
create policy est_reposicao_config_upd on public.est_reposicao_config for update to authenticated using (public.pode_editar(empresa_id)) with check (public.pode_editar(empresa_id));
grant select, insert, update on public.est_reposicao_config to authenticated;
drop trigger if exists zz_auditoria on public.est_reposicao_config;
create trigger zz_auditoria after insert or update or delete on public.est_reposicao_config for each row execute function public._auditar();

create or replace function public.est_reposicao(p_empresa uuid)
returns table(produto_id uuid, codigo text, descricao text, unidade text, familia text, fonte text,
              consumo_janela numeric, consumo_dia numeric, sigma_dia numeric, lead_time numeric, lead_fonte text,
              estoque_seguranca numeric, ponto_pedido numeric, estoque_maximo numeric,
              minimo_atual numeric, ponto_atual numeric, saldo numeric, em_pedido numeric, cobertura_dias numeric,
              giro_anual numeric, dias_sem_saida int, valor_saldo numeric, custo numeric, sugestao numeric, situacao text)
language plpgsql stable security definer set search_path = public as $$
declare cfg est_reposicao_config; v_impl date; v_fonte text; v_z numeric; v_jan int;
begin
  if not public.is_participante(p_empresa) then raise exception 'Sem permissão.'; end if;
  select * into cfg from est_reposicao_config where empresa_id = p_empresa;
  select implantado_em into v_impl from est_config where empresa_id = p_empresa;
  v_jan := coalesce(cfg.janela_dias, 90);
  v_fonte := coalesce(cfg.fonte, 'auto');
  if v_fonte = 'auto' then v_fonte := case when v_impl is not null and v_impl <= current_date - least(v_jan, 30) then 'kardex' else 'compras' end; end if;
  v_z := case coalesce(cfg.nivel_servico, 95) when 90 then 1.28 when 95 then 1.65 when 98 then 2.05 else 2.33 end;
  return query
  with mov as (
    -- consumo diário: saídas do Kardex (líquidas dos estornos) ou compras pelas notas de entrada
    select m.produto_id, m.data dia, -sum(m.quantidade) q
      from est_movimentos m join est_tipos_movimento t on t.id = m.tipo_movimento_id
     where v_fonte = 'kardex' and m.empresa_id = p_empresa and t.sentido = 'S' and m.data > current_date - v_jan
     group by 1, 2
    union all
    select pf.produto_id, n.emissao, sum(i.qcom * pf.fator)
      from nfe_itens i join nfe_notas n on n.id = i.nota_id
      join produto_fornecedores pf on pf.empresa_id = n.empresa_id and pf.emit_doc = n.emit_doc and pf.codigo_fornecedor = i.cprod
     where v_fonte = 'compras' and n.empresa_id = p_empresa and n.tipo = 'entrada' and not n.emissao_propria and n.situacao = 'autorizada'
       and coalesce(n.finalidade, '1') = '1' and n.emissao > current_date - v_jan
     group by 1, 2
  ), sem as (
    -- consumo por semana (com as semanas sem consumo) para a variação
    select p.id produto_id, w.s, coalesce(sum(mov.q), 0) q
      from produtos p cross join generate_series(0, greatest(v_jan / 7 - 1, 0)) w(s)
      left join mov on mov.produto_id = p.id and (current_date - mov.dia) / 7 = w.s
     where p.empresa_id = p_empresa and p.id in (select distinct mov.produto_id from mov)
     group by 1, 2
  ), est as (
    select sem.produto_id, sum(sem.q) tot, sum(sem.q) / (count(*) * 7.0) d, coalesce(stddev_samp(sem.q), 0) / sqrt(7.0) sd from sem group by 1
  ), lt as (
    -- prazo real: do pedido de compra à primeira nota de entrada do mesmo fornecedor com o produto, últimos 12 meses
    select pi.produto_id, avg(greatest(x.emissao - pe.data_pedido, 0))::numeric lt
      from compras_pedido_itens pi join compras_pedidos pe on pe.id = pi.pedido_id
      join favorecidos f on f.id = pe.favorecido_id
      join lateral (select min(n.emissao) emissao from nfe_notas n join nfe_itens i on i.nota_id = n.id
                     join produto_fornecedores pf on pf.empresa_id = n.empresa_id and pf.emit_doc = n.emit_doc and pf.codigo_fornecedor = i.cprod and pf.produto_id = pi.produto_id
                    where n.empresa_id = p_empresa and n.tipo = 'entrada' and n.emissao >= pe.data_pedido and n.emissao <= pe.data_pedido + 180
                      and regexp_replace(coalesce(n.emit_doc, ''), '\D', '', 'g') = regexp_replace(coalesce(f.documento, ''), '\D', '', 'g')) x on x.emissao is not null
     where pe.empresa_id = p_empresa and pi.produto_id is not null and pe.status <> 'cancelado' and pe.data_pedido > current_date - 365
     group by 1
  ), sal as (
    select s.produto_id, sum(s.quantidade) q, sum(s.valor) v from est_saldos s where s.empresa_id = p_empresa group by 1
  ), ped as (
    select pi.produto_id, sum(greatest(pi.quantidade - pi.qtd_recebida, 0)) q
      from compras_pedido_itens pi join compras_pedidos pe on pe.id = pi.pedido_id
     where pe.empresa_id = p_empresa and pe.status in ('aguardando', 'aprovado', 'enviado', 'recebido_parcial') and pi.produto_id is not null
     group by 1
  ), ult as (
    select m.produto_id, max(m.data) d from est_movimentos m join est_tipos_movimento t on t.id = m.tipo_movimento_id
     where m.empresa_id = p_empresa and t.sentido = 'S' group by 1
  ), base as (
    select p.id, p.codigo, p.descricao, p.unidade, fa.nome familia, est.tot, est.d, est.sd,
           coalesce(p.lead_time_dias::numeric, round(lt.lt, 1), cfg.lead_time_padrao, 15) ltd,
           case when p.lead_time_dias is not null then 'produto' when lt.lt is not null then 'real' else 'padrão' end ltf,
           p.estoque_minimo, p.ponto_pedido pp_atual, case when v_impl is not null then coalesce(sal.q, 0) end saldo, coalesce(ped.q, 0) em_ped,
           sal.v, case when v_impl is not null then current_date - ult.d end parado, coalesce(c.custo_medio, (select pf.ultimo_preco from produto_fornecedores pf where pf.produto_id = p.id and pf.ultimo_preco is not null order by pf.ultima_compra desc nulls last limit 1)) custo
      from produtos p left join est on est.produto_id = p.id left join lt on lt.produto_id = p.id left join sal on sal.produto_id = p.id
      left join ped on ped.produto_id = p.id left join ult on ult.produto_id = p.id left join est_familias fa on fa.id = p.familia_id
      left join est_custos c on c.produto_id = p.id
     where p.empresa_id = p_empresa and p.ativo and coalesce(p.tipo_sped, '') <> '04' and (est.tot > 0 or sal.q > 0 or p.ponto_pedido is not null)
  ), calc as (
    select base.*, round(v_z * coalesce(sd, 0) * sqrt(ltd), 3) es,
           round(coalesce(d, 0) * ltd + v_z * coalesce(sd, 0) * sqrt(ltd), 3) pp,
           round(coalesce(d, 0) * ltd + v_z * coalesce(sd, 0) * sqrt(ltd) + coalesce(d, 0) * coalesce(cfg.intervalo_compra_dias, 15), 3) mx
      from base
  )
  select c.id, c.codigo, c.descricao, c.unidade, c.familia, v_fonte, round(coalesce(c.tot, 0), 3), round(coalesce(c.d, 0), 4), round(coalesce(c.sd, 0), 4), c.ltd, c.ltf,
         c.es, c.pp, c.mx, c.estoque_minimo, c.pp_atual, c.saldo, c.em_ped,
         case when c.saldo is not null and c.d > 0 then round(c.saldo / c.d, 1) end,
         case when c.saldo > 0 and c.d > 0 then round(c.d * 365 / c.saldo, 2) end,
         c.parado, round(coalesce(c.v, c.saldo * c.custo), 2), c.custo,
         case when c.saldo is not null and c.saldo + c.em_ped <= c.pp and c.d > 0 then round(greatest(c.mx - c.saldo - c.em_ped, 0), 3) else 0 end,
         case when c.saldo is null then 'sem_estoque'
              when c.saldo > 0 and coalesce(c.d, 0) = 0 and coalesce(c.parado, 9999) >= coalesce(cfg.parado_dias, 90) then 'parado'
              when c.d > 0 and c.saldo <= c.es then 'critico'
              when c.d > 0 and c.saldo + c.em_ped <= c.pp then 'comprar'
              when c.d > 0 and c.saldo > c.mx * 2 then 'excesso'
              else 'ok' end
    from calc c order by 25, 2;
end $$;
revoke all on function public.est_reposicao(uuid) from public, anon;
grant execute on function public.est_reposicao(uuid) to authenticated;

-- aplica no cadastro o mínimo (estoque de segurança), o ponto de pedido e o máximo calculados
create or replace function public.est_reposicao_aplicar(p_empresa uuid, p_itens jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  if not public.pode_editar(p_empresa) then raise exception 'Sem permissão.'; end if;
  if jsonb_typeof(p_itens) <> 'array' then raise exception 'Lista inválida.'; end if;
  update produtos p set estoque_minimo = (x->>'minimo')::numeric, ponto_pedido = (x->>'ponto_pedido')::numeric,
         estoque_maximo = nullif(x->>'maximo', '')::numeric, reposicao_calc_em = now()
    from jsonb_array_elements(p_itens) x
   where p.id = (x->>'produto_id')::uuid and p.empresa_id = p_empresa
     and (x->>'minimo')::numeric >= 0 and (x->>'ponto_pedido')::numeric >= (x->>'minimo')::numeric;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function public.est_reposicao_aplicar(uuid, jsonb) from public, anon;
grant execute on function public.est_reposicao_aplicar(uuid, jsonb) to authenticated;

-- conferência: 1 tabela, 2 colunas e 2 funções
select (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'est_reposicao_config') as tabela,
       (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'produtos' and column_name in ('lead_time_dias', 'reposicao_calc_em')) as colunas,
       (select count(*) from pg_proc where proname in ('est_reposicao', 'est_reposicao_aplicar')) as funcoes;

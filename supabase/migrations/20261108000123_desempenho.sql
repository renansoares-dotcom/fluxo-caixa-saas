-- Desempenho (melhoria 1.9 do plano de melhoria contínua) — 08/11/2026.
-- Aditivo.
--   • medir: cada tela registra quanto tempo levou para abrir (uso_eventos tipo 'carga', em ms); desempenho_resumo
--     mostra, por tela, as aberturas, a mediana, o p90, o pior tempo e quantas passaram do limite (padrão 2 s);
--   • cadastros: cadastros_assinatura devolve uma impressão digital dos cadastros financeiros (plano, contas,
--     favorecidos, centros de custo, grupos); o navegador guarda os cadastros e só baixa de novo quando ela muda;
--   • Lançamentos: os totais do topo saem de lancamentos_totais (soma no banco) em vez de baixar todas as linhas;
--   • índices nas colunas usadas pelos filtros e ligações mais frequentes do estoque, das tintas e da manutenção.
-- Parâmetros (Cadastros › Uso da Plataforma, aba Desempenho): limite em ms e o cache dos cadastros ligado/desligado.

-- 1) medição
alter table public.uso_eventos add column if not exists ms int check (ms is null or ms between 0 and 600000);
alter table public.uso_eventos drop constraint if exists uso_eventos_tipo_check;
alter table public.uso_eventos add constraint uso_eventos_tipo_check check (tipo in ('tela', 'form', 'erro', 'carga'));
alter table public.uso_config add column if not exists limite_ms int not null default 2000 check (limite_ms between 300 and 30000);
alter table public.uso_config add column if not exists cache_cadastros boolean not null default true;
create index if not exists uso_eventos_carga on public.uso_eventos(empresa_id, rota, criado_em) where tipo = 'carga';

create or replace function public.desempenho_resumo(p_empresa uuid, p_de date, p_ate date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare lim int;
begin
  if not public.is_admin(p_empresa) then raise exception 'Só o administrador vê o desempenho.'; end if;
  lim := coalesce((select limite_ms from uso_config where empresa_id = p_empresa), 2000);
  return (with c as (
      select rota, ms, user_id, criado_em from uso_eventos
      where empresa_id = p_empresa and tipo = 'carga' and ms is not null and criado_em >= p_de and criado_em < p_ate + 1)
    select jsonb_build_object(
      'limite_ms', lim,
      'total', (select count(*) from c),
      'acima', (select count(*) from c where ms > lim),
      'p50', (select percentile_disc(0.5) within group (order by ms) from c),
      'p90', (select percentile_disc(0.9) within group (order by ms) from c),
      'telas', coalesce((select jsonb_agg(x order by x.p90 desc) from (
          select rota, count(*) cargas, count(distinct user_id) usuarios,
                 percentile_disc(0.5) within group (order by ms) p50, percentile_disc(0.9) within group (order by ms) p90, max(ms) pior,
                 round(100.0 * count(*) filter (where ms > lim) / count(*), 1) pct_acima
          from c group by rota) x), '[]'::jsonb),
      'dias', coalesce((select jsonb_agg(x order by x.dia) from (
          select criado_em::date dia, count(*) cargas, percentile_disc(0.9) within group (order by ms) p90 from c group by 1) x), '[]'::jsonb)));
end $$;
revoke all on function public.desempenho_resumo(uuid, date, date) from public, anon;
grant execute on function public.desempenho_resumo(uuid, date, date) to authenticated;

-- 2) impressão digital dos cadastros financeiros (muda quando qualquer linha muda)
create or replace function public.cadastros_assinatura(p_empresa uuid)
returns text language plpgsql stable security invoker set search_path = public as $$
begin
  if not public.is_participante(p_empresa) then raise exception 'Sem permissão.'; end if;
  if exists (select 1 from uso_config where empresa_id = p_empresa and not cache_cadastros) then return null; end if;   -- cache desligado
  return md5(concat_ws('|',
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from plano_contas t where t.empresa_id = p_empresa),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from contas t where t.empresa_id = p_empresa),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from favorecidos t where t.empresa_id = p_empresa),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from centros_custo t where t.empresa_id = p_empresa),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from grupos t where t.empresa_id = p_empresa)));
end $$;
revoke all on function public.cadastros_assinatura(uuid) from public, anon;
grant execute on function public.cadastros_assinatura(uuid) to authenticated;

-- 3) totais da tela Lançamentos somados no banco (mesmos filtros da lista; RLS da visão vale: security invoker)
create or replace function public.lancamentos_totais(p_empresa uuid, p_ano int, p_de date default null, p_ate date default null, p_status text default null,
  p_classe uuid default null, p_conta text default null, p_cc uuid default null, p_busca text default null)
returns jsonb language sql stable security invoker set search_path = public as $$
  with l as (
    select tipo, valor_sinal, valor, conta_destino_id from v_lancamentos
    where empresa_id = p_empresa
      and (case when p_de is not null or p_ate is not null then (p_de is null or data >= p_de) and (p_ate is null or data <= p_ate) else data between make_date(p_ano, 1, 1) and make_date(p_ano, 12, 31) end)   -- pela data: usa o índice (empresa, data)
      and (p_status is null or status = p_status)
      and (p_classe is null or classe_id = p_classe)
      and (p_conta is null or (p_conta = 'none' and conta_id is null) or (p_conta <> 'none' and (conta_id::text = p_conta or conta_destino_id::text = p_conta)))
      and (p_cc is null or centro_custo_id = p_cc)
      and (nullif(p_busca, '') is null or descricao ilike '%' || p_busca || '%' or favorecido_nome ilike '%' || p_busca || '%' or opc1 ilike '%' || p_busca || '%'
           or plano_nome ilike '%' || p_busca || '%' or documento ilike '%' || p_busca || '%'))
  select jsonb_build_object('n', count(*),
    'ent', coalesce(sum(valor_sinal) filter (where tipo = 'E'), 0),
    'sai', coalesce(sum(valor_sinal) filter (where tipo = 'S'), 0),
    -- transferência vista pela conta filtrada: no destino é entrada; sem filtro de conta soma zero
    'trf', coalesce(sum(case when conta_destino_id is null then valor_sinal when p_conta is not null and p_conta = conta_destino_id::text then valor
                             when p_conta is not null and p_conta <> 'none' then valor_sinal else 0 end) filter (where tipo = 'T'), 0))
  from l
$$;
revoke all on function public.lancamentos_totais(uuid, int, date, date, text, uuid, text, uuid, text) from public, anon;
grant execute on function public.lancamentos_totais(uuid, int, date, date, text, uuid, text, uuid, text) to authenticated;

-- 4) índices
create index if not exists est_mov_lote on public.est_movimentos(lote_id) where lote_id is not null;
create index if not exists est_mov_estorno on public.est_movimentos(estorno_de) where estorno_de is not null;
create index if not exists est_mov_tipo on public.est_movimentos(tipo_movimento_id);
create index if not exists est_saldos_local on public.est_saldos(local_id);
create index if not exists est_saldos_lote on public.est_saldos(lote_id) where lote_id is not null;
create index if not exists est_saldos_emp on public.est_saldos(empresa_id, produto_id);
create index if not exists tin_pes_item on public.tin_pesagens(item_id) where item_id is not null;
create index if not exists tin_pes_mov on public.tin_pesagens(movimento_id) where movimento_id is not null;
create index if not exists man_ordens_parada on public.man_ordens(parada_id) where parada_id is not null;

select (select count(*) from pg_proc where proname in ('desempenho_resumo', 'cadastros_assinatura', 'lancamentos_totais')) as funcoes;

-- Avaliação dos fornecedores — IQF (melhoria 5.6 do plano de melhoria contínua, Passo 4) — 08/11/2026.
-- Aditivo. O IQF junta três notas de 0 a 100, com os pesos dos parâmetros:
--   • Qualidade: inspeções de recebimento decididas (aprovada = 100, concessão = 50, reprovada = 0) — a mesma régua do painel da Qualidade;
--   • Entrega: cada pedido pelo 1º recebimento — no prazo (com a tolerância do confronto) = 100; perde N pontos por dia de atraso;
--   • Preço e nota: cada recebimento com nota — 100 se a nota conferiu com o pedido; 0 se teve divergência que bloqueia (SQL 133).
-- Dimensão sem dado no período não entra (os pesos das outras são reponderados). Classe A, B ou C pela faixa e pela meta;
-- com menos eventos que o mínimo, a classe é "N" (poucos dados). Aparece no Painel de Compras e no mapa comparativo das cotações.

alter table public.compras_parametros add column if not exists iqf_peso_qualidade numeric(5,2) not null default 40;
alter table public.compras_parametros add column if not exists iqf_peso_entrega numeric(5,2) not null default 35;
alter table public.compras_parametros add column if not exists iqf_peso_preco numeric(5,2) not null default 25;
alter table public.compras_parametros add column if not exists iqf_meses int not null default 12;
alter table public.compras_parametros add column if not exists iqf_meta numeric(5,2) not null default 80;            -- abaixo: classe C
alter table public.compras_parametros add column if not exists iqf_faixa_a numeric(5,2) not null default 90;         -- a partir: classe A
alter table public.compras_parametros add column if not exists iqf_pontos_dia_atraso numeric(5,2) not null default 10;
alter table public.compras_parametros add column if not exists iqf_min_eventos int not null default 3;
do $$ begin
  alter table public.compras_parametros add constraint compras_par_iqf_chk check (iqf_peso_qualidade >= 0 and iqf_peso_entrega >= 0 and iqf_peso_preco >= 0
    and iqf_peso_qualidade + iqf_peso_entrega + iqf_peso_preco > 0 and iqf_meses between 1 and 60 and iqf_meta between 0 and 100 and iqf_faixa_a between 0 and 100
    and iqf_pontos_dia_atraso between 0 and 100 and iqf_min_eventos between 1 and 100);
exception when duplicate_object then null; end $$;

-- os eventos que formam o IQF (um por linha): dimensão, data, nota de 0 a 100 e o texto
create or replace function public._iqf_eventos(p_empresa uuid, p_de date, p_ate date)
returns table(favorecido_id uuid, dimensao text, data date, nota numeric, texto text) language sql stable security definer set search_path = public as $$
  with c as (select coalesce(conf_tol_entrega_dias, 2) tol, coalesce(iqf_pontos_dia_atraso, 10) pts from compras_parametros where empresa_id = p_empresa
             union all select 2, 10 where not exists (select 1 from compras_parametros where empresa_id = p_empresa) limit 1)
  -- qualidade
  select i.fornecedor_id, 'qualidade', i.decidida_em::date,
         case i.situacao when 'aprovada' then 100 when 'aprovada_concessao' then 50 else 0 end::numeric,
         format('Inspeção %s: %s', i.numero, case i.situacao when 'aprovada' then 'aprovada' when 'aprovada_concessao' then 'aprovada com concessão' else 'reprovada' end)
    from qual_inspecoes i
   where i.empresa_id = p_empresa and i.fornecedor_id is not null and i.situacao in ('aprovada', 'aprovada_concessao', 'reprovada')
     and i.decidida_em::date between p_de and p_ate
  union all
  -- entrega: 1º recebimento de cada pedido com entrega prevista
  select p.favorecido_id, 'entrega', r.data,
         greatest(0, 100 - greatest(0, r.data - p.entrega_prevista - c.tol) * c.pts)::numeric,
         case when r.data - p.entrega_prevista > c.tol then format('PC %s: entregue %s dia(s) depois do previsto (%s)', p.numero, r.data - p.entrega_prevista, to_char(p.entrega_prevista, 'DD/MM/YYYY'))
              else format('PC %s: entregue no prazo', p.numero) end
    from compras_pedidos p cross join c
    join lateral (select min(r.data) data from compras_recebimentos r where r.pedido_id = p.id) r on r.data is not null
   where p.empresa_id = p_empresa and p.entrega_prevista is not null and r.data between p_de and p_ate
  union all
  -- preço e nota: cada recebimento com nota
  select p.favorecido_id, 'preco', r.data,
         case when exists (select 1 from jsonb_array_elements(r.divergencias) d where (d ->> 'bloqueia')::boolean is true) then 0 else 100 end::numeric,
         case when exists (select 1 from jsonb_array_elements(r.divergencias) d where (d ->> 'bloqueia')::boolean is true)
              then format('PC %s: %s', p.numero, (select string_agg(d ->> 'texto', ' · ') from jsonb_array_elements(r.divergencias) d where (d ->> 'bloqueia')::boolean is true))
              else format('PC %s: nota conferiu com o pedido', p.numero) end
    from compras_recebimentos r join compras_pedidos p on p.id = r.pedido_id
   where r.empresa_id = p_empresa and r.nfe_nota_id is not null and r.data between p_de and p_ate
$$;
revoke all on function public._iqf_eventos(uuid, date, date) from public, anon, authenticated;

-- o IQF por fornecedor; com p_favorecido, traz também os eventos
create or replace function public.compras_iqf(p_empresa uuid, p_favorecido uuid default null, p_ate date default current_date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare c compras_parametros; v_de date;
begin
  if not (is_participante(p_empresa) or pode_comprar(p_empresa)) then raise exception 'Acesso negado.'; end if;
  select * into c from compras_parametros where empresa_id = p_empresa;
  v_de := (coalesce(p_ate, current_date) - make_interval(months => coalesce(c.iqf_meses, 12)))::date + 1;
  return (with e as (select * from _iqf_eventos(p_empresa, v_de, coalesce(p_ate, current_date)) where p_favorecido is null or favorecido_id = p_favorecido),
    d as (select favorecido_id,
                 round(avg(nota) filter (where dimensao = 'qualidade'), 1) q, count(*) filter (where dimensao = 'qualidade') nq,
                 round(avg(nota) filter (where dimensao = 'entrega'), 1) en, count(*) filter (where dimensao = 'entrega') ne,
                 round(avg(nota) filter (where dimensao = 'preco'), 1) pr, count(*) filter (where dimensao = 'preco') np
            from e group by favorecido_id),
    w as (select d.*, coalesce(c.iqf_peso_qualidade, 40) wq, coalesce(c.iqf_peso_entrega, 35) we, coalesce(c.iqf_peso_preco, 25) wp from d),
    i as (select w.*, round((coalesce(q * wq, 0) + coalesce(en * we, 0) + coalesce(pr * wp, 0))
                       / nullif((case when q is null then 0 else wq end) + (case when en is null then 0 else we end) + (case when pr is null then 0 else wp end), 0), 1) iqf from w)
    select coalesce(jsonb_agg(jsonb_build_object('favorecido_id', i.favorecido_id, 'nome', f.nome,
             'qualidade', i.q, 'n_qualidade', i.nq, 'entrega', i.en, 'n_entrega', i.ne, 'preco', i.pr, 'n_preco', i.np, 'iqf', i.iqf,
             'classe', case when i.nq + i.ne + i.np < coalesce(c.iqf_min_eventos, 3) then 'N' when i.iqf >= coalesce(c.iqf_faixa_a, 90) then 'A'
                            when i.iqf >= coalesce(c.iqf_meta, 80) then 'B' else 'C' end,
             'eventos', case when p_favorecido is null then null else
               (select jsonb_agg(jsonb_build_object('dimensao', x.dimensao, 'data', x.data, 'nota', x.nota, 'texto', x.texto) order by x.data desc) from e x where x.favorecido_id = i.favorecido_id) end)
           order by i.iqf, f.nome), '[]')
      from i join favorecidos f on f.id = i.favorecido_id);
end $$;
revoke all on function public.compras_iqf(uuid, uuid, date) from public, anon;
grant execute on function public.compras_iqf(uuid, uuid, date) to authenticated;

select count(*) as parametros_iqf from information_schema.columns where table_name = 'compras_parametros' and column_name like 'iqf_%';

-- Frete próprio × terceirizado por rota (melhoria 7.2 do plano de melhoria contínua, Passo 4) — 08/11/2026.
-- Aditivo. A montagem de carga sugerida (peso, volume, região e jornada) já existe em Cargas e Entregas (SQL 045);
-- esta migração entrega a outra metade da 7.2: o custo por tonelada de cada rota (destino), com a frota própria e com terceiros.
--   • próprio: cargas da frota que saíram (sem frete de terceiro ligado), custo = km (real ou previsto) × custo/km do veículo
--     (ou consumo × diesel; sem isso, o frete previsto da carga), rateado entre as notas pelo peso;
--   • terceiro: fichas de frete (Fretes e CIOT) não canceladas, valor + pedágio, rateado entre as notas da carga ligada
--     ou das notas informadas na ficha (pelos números); sem nota, a rota é o destino escrito na ficha;
--   • a rota é o município de destino (ou a UF, nos parâmetros); a sugestão compara o R$/t dos dois lados quando cada
--     um tem o peso mínimo, e estima quanto se economizaria movendo o peso da opção cara para a barata.

alter table public.log_parametros add column if not exists comp_rota_por text not null default 'municipio';
alter table public.log_parametros add column if not exists comp_meses int not null default 6;
alter table public.log_parametros add column if not exists comp_dif_pct numeric(5,1) not null default 10;   -- diferença de R$/t para sugerir troca
alter table public.log_parametros add column if not exists comp_min_t numeric(8,2) not null default 1;     -- toneladas mínimas de cada lado para comparar
do $$ begin
  alter table public.log_parametros add constraint log_par_comp_chk check (comp_rota_por in ('uf', 'municipio') and comp_meses between 1 and 24
    and comp_dif_pct between 0 and 100 and comp_min_t >= 0);
exception when duplicate_object then null; end $$;

-- destino e peso de uma nota de saída (lidos do XML)
create or replace function public._log_nota_destino(p_nota uuid)
returns table(uf text, xmun text, peso_kg numeric) language sql stable security definer set search_path = public as $$
  with ns as (select array[array['n', 'http://www.portalfiscal.inf.br/nfe']] a)
  select coalesce(n.dest_uf, (xpath('//n:dest/n:enderDest/n:UF/text()', n.xml::xml, ns.a))[1]::text),
         upper((xpath('//n:dest/n:enderDest/n:xMun/text()', n.xml::xml, ns.a))[1]::text),
         coalesce((select sum(nullif(v::text, '')::numeric) from unnest(xpath('//n:transp/n:vol/n:pesoB/text()', n.xml::xml, ns.a)) v), 0)
    from nfe_notas n, ns where n.id = p_nota and n.xml is not null
$$;
revoke all on function public._log_nota_destino(uuid) from public, anon, authenticated;

create or replace function public.log_frete_comparativo(p_empresa uuid, p_ate date default current_date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare P log_parametros; v_de date; v_ate date := coalesce(p_ate, current_date); v_por text;
begin
  if not ve_logistica(p_empresa) then raise exception 'Sem permissão para a logística.'; end if;
  select * into P from log_parametros where empresa_id = p_empresa;
  v_de := (v_ate - make_interval(months => coalesce(P.comp_meses, 6)))::date + 1;
  v_por := coalesce(P.comp_rota_por, 'municipio');
  return (
  with fr as (   -- fretes de terceiros no período
    select f.id, f.carga_id, f.data, coalesce(f.valor, 0) + coalesce(f.pedagio_valor, 0) custo, f.destino, f.notas
      from log_fretes f where f.empresa_id = p_empresa and f.status <> 'cancelado' and f.data between v_de and v_ate and coalesce(f.valor, 0) > 0),
  pr as (        -- cargas próprias no período (saíram e não têm frete de terceiro ligado)
    select c.id, c.data,
           coalesce(case when coalesce(c.km_real, c.km_previsto) > 0 and v.custo_km > 0 then coalesce(c.km_real, c.km_previsto) * v.custo_km
                         when coalesce(c.km_real, c.km_previsto) > 0 and v.consumo_km_l > 0 and P.diesel_rs_l > 0 then coalesce(c.km_real, c.km_previsto) / v.consumo_km_l * P.diesel_rs_l end,
                    c.frete_previsto, 0) custo
      from log_cargas c left join log_veiculos v on v.id = c.veiculo_id
     where c.empresa_id = p_empresa and c.status in ('em_rota', 'concluida') and c.data between v_de and v_ate
       and not exists (select 1 from log_fretes f where f.carga_id = c.id and f.status <> 'cancelado')),
  -- notas de cada viagem (própria ou de terceiro)
  vn as (
    select 'proprio' modal, pr.id viagem, pr.custo, cn.nota_id, coalesce(nullif(cn.peso_kg, 0), d.peso_kg) peso, d.uf, d.xmun, null::text destino
      from pr join log_carga_notas cn on cn.carga_id = pr.id and cn.situacao <> 'devolvida' cross join lateral _log_nota_destino(cn.nota_id) d
    union all
    select 'terceiro', fr.id, fr.custo, cn.nota_id, coalesce(nullif(cn.peso_kg, 0), d.peso_kg), d.uf, d.xmun, fr.destino
      from fr join log_carga_notas cn on cn.carga_id = fr.carga_id cross join lateral _log_nota_destino(cn.nota_id) d
    union all
    select 'terceiro', fr.id, fr.custo, n.id, d.peso_kg, d.uf, d.xmun, fr.destino
      from fr join nfe_notas n on fr.carga_id is null and n.empresa_id = p_empresa and n.tipo = 'saida' and n.emissao_propria and n.situacao = 'autorizada'
                              and n.emissao between fr.data - 60 and fr.data + 5
                              and n.numero::text = any(regexp_split_to_array(coalesce(fr.notas, ''), '[^0-9]+'))
      cross join lateral _log_nota_destino(n.id) d
    union all   -- frete sem nota identificada: a rota é o destino da ficha, sem peso
    select 'terceiro', fr.id, fr.custo, null, null, null, null, coalesce(nullif(trim(fr.destino), ''), 'DESTINO NÃO INFORMADO')
      from fr where fr.carga_id is null and not exists (select 1 from nfe_notas n where n.empresa_id = p_empresa and n.tipo = 'saida' and n.emissao_propria and n.situacao = 'autorizada'
                              and n.emissao between fr.data - 60 and fr.data + 5 and n.numero::text = any(regexp_split_to_array(coalesce(fr.notas, ''), '[^0-9]+')))),
  -- rateio pelo peso (sem peso, pela quantidade de notas)
  ra as (
    select vn.*, case when v_por = 'uf' then coalesce(vn.uf, upper(vn.destino)) else coalesce(vn.xmun || ' / ' || vn.uf, upper(vn.destino)) end rota,
           vn.custo * case when sum(coalesce(vn.peso, 0)) over (partition by vn.modal, vn.viagem) > 0 then coalesce(vn.peso, 0) / sum(coalesce(vn.peso, 0)) over (partition by vn.modal, vn.viagem)
                           else 1.0 / count(*) over (partition by vn.modal, vn.viagem) end parte
      from vn),
  ro as (
    select rota,
           count(distinct viagem) filter (where modal = 'proprio') vp, count(nota_id) filter (where modal = 'proprio') np,
           round(sum(coalesce(peso, 0)) filter (where modal = 'proprio'), 1) kp, round(sum(parte) filter (where modal = 'proprio'), 2) cp,
           count(distinct viagem) filter (where modal = 'terceiro') vt, count(nota_id) filter (where modal = 'terceiro') nt,
           round(sum(coalesce(peso, 0)) filter (where modal = 'terceiro'), 1) kt, round(sum(parte) filter (where modal = 'terceiro'), 2) ct
      from ra group by rota),
  rs as (
    select ro.*, case when kp > 0 then round(cp / kp * 1000, 2) end tp, case when kt > 0 then round(ct / kt * 1000, 2) end tt from ro),
  sg as (
    select rs.*,
           case when tp is null or tt is null or kp < coalesce(P.comp_min_t, 1) * 1000 or kt < coalesce(P.comp_min_t, 1) * 1000 then null
                else round((tt / tp - 1) * 100, 1) end dif,
           case when tp is null or tt is null or kp < coalesce(P.comp_min_t, 1) * 1000 or kt < coalesce(P.comp_min_t, 1) * 1000 then 'sem_base'
                when tt < tp * (1 - coalesce(P.comp_dif_pct, 10) / 100) then 'terceirizar'
                when tp < tt * (1 - coalesce(P.comp_dif_pct, 10) / 100) then 'frota_propria'
                else 'equivalente' end sugestao
      from rs)
  select jsonb_build_object('de', v_de, 'ate', v_ate, 'rota_por', v_por, 'dif_pct', coalesce(P.comp_dif_pct, 10), 'min_t', coalesce(P.comp_min_t, 1),
    'rotas', coalesce((select jsonb_agg(jsonb_build_object('rota', rota,
        'proprio', jsonb_build_object('viagens', vp, 'notas', np, 'peso_kg', kp, 'custo', cp, 'rs_t', tp),
        'terceiro', jsonb_build_object('viagens', vt, 'notas', nt, 'peso_kg', kt, 'custo', ct, 'rs_t', tt),
        'dif_pct', dif, 'sugestao', sugestao,
        'economia', case sugestao when 'terceirizar' then round((tp - tt) * kp / 1000, 2) when 'frota_propria' then round((tt - tp) * kt / 1000, 2) else 0 end)
      order by coalesce(cp, 0) + coalesce(ct, 0) desc) from sg), '[]'::jsonb)));
end $$;
revoke all on function public.log_frete_comparativo(uuid, date) from public, anon;
grant execute on function public.log_frete_comparativo(uuid, date) to authenticated;

select count(*) as parametros_comp from information_schema.columns where table_name = 'log_parametros' and column_name like 'comp_%';

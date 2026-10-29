-- =====================================================================
-- Fretes › MDF-e — passo 3 (29/10/2026, Renan: "pode seguir com o passo 3"; diretoria alinhando emitir pela plataforma).
-- A ficha do frete passa a guardar os dados do MDF-e (leiaute 3.00 + NT 2026.001: CIOT obrigatório quando a IPLAMM emite
-- MDF-e de carga própria com veículo de terceiro — rejeição 684 a partir de 23/11/2026).
--  - log_fretes.mdfe_emissor: quem emite o MDF-e desta viagem (IPLAMM, carga própria; ou a transportadora, com CT-e)
--  - log_fretes.mdfe (jsonb): percurso, carregamento, descarregamento com as NF-e, veículo e reboques, condutor, seguro,
--    produto predominante, totais, pagamento do frete (infPag), CIOT e responsável, vale-pedágio e situação do MDF-e
--  - log_parametros.mdfe_padrao (jsonb): dados que se repetem (seguradora, apólice, IPEF, produto predominante…)
--  - log_mdfe_notas: chave, destino (município IBGE), peso e valor das NF-e de saída pelo número ou pela carga
-- Migração ADITIVA: nada existente muda. Pode rodar mais de uma vez.
-- =====================================================================
alter table public.log_fretes add column if not exists mdfe_emissor text;
alter table public.log_fretes drop constraint if exists log_fretes_mdfe_emissor_check;
alter table public.log_fretes add constraint log_fretes_mdfe_emissor_check check (mdfe_emissor is null or mdfe_emissor in ('iplamm', 'transportadora'));
alter table public.log_fretes add column if not exists mdfe jsonb not null default '{}'::jsonb;
alter table public.log_parametros add column if not exists mdfe_padrao jsonb not null default '{}'::jsonb;

-- NF-e de saída para o MDF-e: pelo número (campo "NF-e transportadas") ou pelas notas da carga da logística
create or replace function public.log_mdfe_notas(p_empresa uuid, p_numeros int[] default '{}', p_carga uuid default null)
returns table(nota_id uuid, numero int, serie text, chave text, emissao date, dest_nome text, uf text, cmun text, xmun text,
              emit_cmun text, emit_xmun text, emit_uf text, v_nf numeric, peso_kg numeric, ncm text, produto text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not ve_logistica(p_empresa) then raise exception 'Sem permissão para a logística.'; end if;
  return query
  with ns as (select array[array['n', 'http://www.portalfiscal.inf.br/nfe']] a),
  alvo as (
    select n.* from nfe_notas n
     where n.empresa_id = p_empresa and n.emissao_propria and coalesce(n.tipo, 'saida') <> 'entrada'
       and (n.numero = any(coalesce(p_numeros, '{}'))
            or (p_carga is not null and n.id in (select cn.nota_id from log_carga_notas cn where cn.carga_id = p_carga and cn.empresa_id = p_empresa)))
  )
  select a.id, a.numero, a.serie, a.chave, a.emissao, a.dest_nome, a.dest_uf,
         (xpath('//n:dest/n:enderDest/n:cMun/text()', a.xml::xml, ns.a))[1]::text,
         (xpath('//n:dest/n:enderDest/n:xMun/text()', a.xml::xml, ns.a))[1]::text,
         (xpath('//n:emit/n:enderEmit/n:cMun/text()', a.xml::xml, ns.a))[1]::text,
         (xpath('//n:emit/n:enderEmit/n:xMun/text()', a.xml::xml, ns.a))[1]::text,
         (xpath('//n:emit/n:enderEmit/n:UF/text()', a.xml::xml, ns.a))[1]::text,
         a.v_nf,
         coalesce((select sum(nullif(v::text, '')::numeric) from unnest(xpath('//n:transp/n:vol/n:pesoB/text()', a.xml::xml, ns.a)) v),
                  (select sum(cn.peso_kg) from log_carga_notas cn where cn.nota_id = a.id)),
         (select i.ncm from nfe_itens i where i.nota_id = a.id order by i.vprod desc nulls last limit 1),
         (select i.xprod from nfe_itens i where i.nota_id = a.id order by i.vprod desc nulls last limit 1)
    from alvo a, ns
   where a.xml is not null
   order by a.numero;
end $$;
revoke execute on function public.log_mdfe_notas(uuid, int[], uuid) from public, anon;
grant execute on function public.log_mdfe_notas(uuid, int[], uuid) to authenticated, service_role;

-- municípios (código IBGE, nome, UF) que já aparecem nas NF-e da empresa: para escolher carregamento e descarga
create or replace function public.log_mdfe_municipios(p_empresa uuid)
returns table(cmun text, xmun text, uf text, usos int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not ve_logistica(p_empresa) then raise exception 'Sem permissão para a logística.'; end if;
  return query
  with ns as (select array[array['n', 'http://www.portalfiscal.inf.br/nfe']] a),
  m as (
    select (xpath('//n:dest/n:enderDest/n:cMun/text()', n.xml::xml, ns.a))[1]::text c, (xpath('//n:dest/n:enderDest/n:xMun/text()', n.xml::xml, ns.a))[1]::text x,
           (xpath('//n:dest/n:enderDest/n:UF/text()', n.xml::xml, ns.a))[1]::text u
      from nfe_notas n, ns where n.empresa_id = p_empresa and n.xml is not null and n.emissao >= current_date - 730
    union all
    select (xpath('//n:emit/n:enderEmit/n:cMun/text()', n.xml::xml, ns.a))[1]::text, (xpath('//n:emit/n:enderEmit/n:xMun/text()', n.xml::xml, ns.a))[1]::text,
           (xpath('//n:emit/n:enderEmit/n:UF/text()', n.xml::xml, ns.a))[1]::text
      from nfe_notas n, ns where n.empresa_id = p_empresa and n.xml is not null and n.emissao_propria and n.emissao >= current_date - 730
  )
  select m.c, max(m.x), max(m.u), count(*)::int from m where m.c ~ '^[0-9]{7}$' group by m.c order by 4 desc, 2;
end $$;
revoke execute on function public.log_mdfe_municipios(uuid) from public, anon;
grant execute on function public.log_mdfe_municipios(uuid) to authenticated, service_role;

-- conferência: colunas = 3, funcoes = 2
select (select count(*) from information_schema.columns where table_schema = 'public'
          and ((table_name = 'log_fretes' and column_name in ('mdfe_emissor', 'mdfe')) or (table_name = 'log_parametros' and column_name = 'mdfe_padrao'))) as colunas,
       (select count(*) from pg_proc where proname in ('log_mdfe_notas', 'log_mdfe_municipios')) as funcoes;

-- 081 · NF-e do cliente para o transporte (IPLAMM → KRATOS).
-- A transportadora do grupo usa as NF-e que o cliente já importou, sem importar de novo: o cliente autoriza,
-- a transportadora lê só o que o frete, o CT-e, o MDF-e e o CIOT precisam (chave, destino, peso, valor, produto principal).
-- Essas notas NÃO entram no faturamento nem nos impostos da transportadora.
-- Aditiva: log_mdfe_notas mantém a assinatura e passa a procurar também nas notas autorizadas. Pode rodar mais de uma vez.

-- 1) Autorização: o administrador da empresa DONA das notas libera para a transportadora
create table if not exists public.nfe_compartilhamento (
  id uuid primary key default gen_random_uuid(),
  empresa_origem uuid not null references public.empresas(id),   -- dona das NF-e (cliente)
  empresa_destino uuid not null references public.empresas(id),  -- transportadora que lê
  empresa_id uuid generated always as (empresa_origem) stored,     -- para a auditoria (dona da autorização)
  finalidade text not null default 'transporte' check (finalidade in ('transporte')),
  ativo boolean not null default true,
  desde date not null default date '2026-01-01',                  -- só notas emitidas a partir desta data
  observacao text,
  criado_em timestamptz not null default now(),
  criado_por uuid default auth.uid(),
  unique (empresa_origem, empresa_destino, finalidade),
  check (empresa_origem <> empresa_destino)
);
alter table public.nfe_compartilhamento enable row level security;
drop policy if exists nfe_comp_sel on public.nfe_compartilhamento;
create policy nfe_comp_sel on public.nfe_compartilhamento for select to authenticated
  using (empresa_origem in (select public.minhas_empresas()) or empresa_destino in (select public.minhas_empresas()));
drop policy if exists nfe_comp_ins on public.nfe_compartilhamento;
create policy nfe_comp_ins on public.nfe_compartilhamento for insert to authenticated with check (public.is_admin(empresa_origem));
drop policy if exists nfe_comp_upd on public.nfe_compartilhamento;
create policy nfe_comp_upd on public.nfe_compartilhamento for update to authenticated using (public.is_admin(empresa_origem)) with check (public.is_admin(empresa_origem));
drop policy if exists nfe_comp_del on public.nfe_compartilhamento;
create policy nfe_comp_del on public.nfe_compartilhamento for delete to authenticated using (public.is_admin(empresa_origem));
grant select, insert, update, delete on public.nfe_compartilhamento to authenticated;
drop trigger if exists zz_auditoria on public.nfe_compartilhamento;
create trigger zz_auditoria after insert or update or delete on public.nfe_compartilhamento for each row execute function public._auditar();

-- empresas cujas notas a transportadora pode ler
create or replace function public._nfe_origens(p_destino uuid) returns table(empresa_id uuid, desde date)
language sql stable security definer set search_path = public as $$
  select c.empresa_origem, c.desde from nfe_compartilhamento c where c.empresa_destino = p_destino and c.ativo and c.finalidade = 'transporte'
$$;
revoke execute on function public._nfe_origens(uuid) from public, anon, authenticated;

-- 2) MDF-e/CIOT: "Buscar NF-e" acha as notas próprias e as dos clientes autorizados (mesma assinatura e mesmas colunas)
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
    union all
    select n.* from nfe_notas n join _nfe_origens(p_empresa) o on o.empresa_id = n.empresa_id
     where n.emissao_propria and coalesce(n.tipo, 'saida') <> 'entrada' and n.emissao >= o.desde
       and n.situacao = 'autorizada'
       and n.numero = any(coalesce(p_numeros, '{}'))
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
   order by a.emissao, a.numero;
end $$;
revoke execute on function public.log_mdfe_notas(uuid, int[], uuid) from public, anon;
grant execute on function public.log_mdfe_notas(uuid, int[], uuid) to authenticated, service_role;

-- 3) Lista para escolher as notas do cliente na ficha do frete (por período e busca).
--    Traz a transportadora da nota: as que já indicam esta empresa vêm primeiro.
create or replace function public.log_nfe_cliente(p_empresa uuid, p_de date, p_ate date, p_busca text default null)
returns table(nota_id uuid, origem text, numero int, serie text, chave text, emissao date, dest_nome text, dest_uf text, xmun text,
              v_nf numeric, peso_kg numeric, transp_doc text, transp_nome text, mod_frete text, desta_empresa boolean)
language plpgsql stable security definer set search_path = public as $$
declare v_doc text;
begin
  if not ve_logistica(p_empresa) then raise exception 'Sem permissão para a logística.'; end if;
  if p_ate - p_de > 62 then raise exception 'Escolha um período de até 2 meses.'; end if;
  select regexp_replace(coalesce(cnpj, ''), '\D', '', 'g') into v_doc from empresas where id = p_empresa;
  return query
  with ns as (select array[array['n', 'http://www.portalfiscal.inf.br/nfe']] a),
  base as (
    select n.*, e.nome as origem_nome,
           (xpath('//n:transp/n:transporta/n:CNPJ/text()', n.xml::xml, ns.a))[1]::text t_cnpj,
           (xpath('//n:transp/n:transporta/n:CPF/text()', n.xml::xml, ns.a))[1]::text t_cpf,
           (xpath('//n:transp/n:transporta/n:xNome/text()', n.xml::xml, ns.a))[1]::text t_nome,
           (xpath('//n:transp/n:modFrete/text()', n.xml::xml, ns.a))[1]::text m_frete,
           (xpath('//n:dest/n:enderDest/n:xMun/text()', n.xml::xml, ns.a))[1]::text d_mun,
           (select sum(nullif(v::text, '')::numeric) from unnest(xpath('//n:transp/n:vol/n:pesoB/text()', n.xml::xml, ns.a)) v) peso
      from nfe_notas n join _nfe_origens(p_empresa) o on o.empresa_id = n.empresa_id join empresas e on e.id = n.empresa_id, ns
     where n.emissao_propria and coalesce(n.tipo, 'saida') <> 'entrada' and n.situacao = 'autorizada'
       and n.emissao between greatest(p_de, o.desde) and p_ate and n.xml is not null
       and (p_busca is null or p_busca = '' or n.numero::text = p_busca or n.dest_nome ilike '%' || p_busca || '%')
  )
  select b.id, b.origem_nome, b.numero, b.serie, b.chave, b.emissao, b.dest_nome, b.dest_uf, b.d_mun, b.v_nf, b.peso,
         coalesce(b.t_cnpj, b.t_cpf), b.t_nome, b.m_frete, coalesce(b.t_cnpj, '') = v_doc and v_doc <> ''
    from base b
   order by (coalesce(b.t_cnpj, '') = v_doc and v_doc <> '') desc, b.emissao desc, b.numero desc
   limit 500;
end $$;
revoke execute on function public.log_nfe_cliente(uuid, date, date, text) from public, anon;
grant execute on function public.log_nfe_cliente(uuid, date, date, text) to authenticated, service_role;

-- 4) Autorização IPLAMM → KRATOS (pedida pelo Renan em 04/11/2026). Nos ambientes sem essas empresas, não faz nada.
insert into public.nfe_compartilhamento (empresa_origem, empresa_destino, finalidade, desde, observacao)
select o.id, d.id, 'transporte', date '2026-01-01', 'IPLAMM é cliente da KRATOS: NF-e de saída para frete, CT-e, MDF-e e CIOT'
  from public.empresas o, public.empresas d
 where regexp_replace(o.cnpj, '\D', '', 'g') = '14677338000197' and regexp_replace(d.cnpj, '\D', '', 'g') = '58190879000161'
on conflict (empresa_origem, empresa_destino, finalidade) do nothing;

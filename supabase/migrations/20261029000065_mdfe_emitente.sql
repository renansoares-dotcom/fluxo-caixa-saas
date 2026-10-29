-- =====================================================================
-- Fretes › MDF-e — endereço do emitente para o XML (29/10/2026).
-- O MDF-e leva o endereço completo do emitente (logradouro, número, bairro, município IBGE, CEP, UF, telefone).
-- O cadastro da empresa não tem número, bairro nem código IBGE; a função lê o grupo <emit> da NF-e própria mais
-- recente, que a SEFAZ já aceitou. Só leitura. Pode rodar mais de uma vez.
-- =====================================================================
create or replace function public.log_mdfe_emitente(p_empresa uuid)
returns table(cnpj text, ie text, xnome text, xlgr text, nro text, xcpl text, xbairro text, cmun text, xmun text, cep text, uf text, fone text)
language plpgsql stable security definer set search_path = public as $$
declare x xml; ns text[] := array[array['n', 'http://www.portalfiscal.inf.br/nfe']];
begin
  if not ve_logistica(p_empresa) then raise exception 'Sem permissão para a logística.'; end if;
  select n.xml::xml into x from nfe_notas n
   where n.empresa_id = p_empresa and n.emissao_propria and n.xml is not null order by n.emissao desc, n.numero desc limit 1;
  if x is null then return; end if;
  return query select
    (xpath('//n:emit/n:CNPJ/text()', x, ns))[1]::text, (xpath('//n:emit/n:IE/text()', x, ns))[1]::text, (xpath('//n:emit/n:xNome/text()', x, ns))[1]::text,
    (xpath('//n:emit/n:enderEmit/n:xLgr/text()', x, ns))[1]::text, (xpath('//n:emit/n:enderEmit/n:nro/text()', x, ns))[1]::text,
    (xpath('//n:emit/n:enderEmit/n:xCpl/text()', x, ns))[1]::text, (xpath('//n:emit/n:enderEmit/n:xBairro/text()', x, ns))[1]::text,
    (xpath('//n:emit/n:enderEmit/n:cMun/text()', x, ns))[1]::text, (xpath('//n:emit/n:enderEmit/n:xMun/text()', x, ns))[1]::text,
    (xpath('//n:emit/n:enderEmit/n:CEP/text()', x, ns))[1]::text, (xpath('//n:emit/n:enderEmit/n:UF/text()', x, ns))[1]::text,
    (xpath('//n:emit/n:enderEmit/n:fone/text()', x, ns))[1]::text;
end $$;
revoke execute on function public.log_mdfe_emitente(uuid) from public, anon;
grant execute on function public.log_mdfe_emitente(uuid) to authenticated, service_role;

-- conferência: funcao = 1
select count(*) as funcao from pg_proc where proname = 'log_mdfe_emitente';

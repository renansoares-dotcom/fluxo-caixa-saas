-- NF-e do cliente para o transporte (SQL 081): sem autorização a transportadora não vê nada; o admin da dona autoriza;
-- a transportadora acha a nota pelo número (MDF-e) e na lista; a transportadora não consegue se autorizar sozinha.
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null
create or replace function pg_temp.entrar(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p::text, false);
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated', 'aal', 'aal1')::text, false);
  set role authenticated;
end $$;
create or replace function pg_temp.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin if not coalesce(p_cond, false) then raise exception 'FALHOU: %', p_msg; end if; end $$;

update empresas set cnpj = '22.222.222/0001-22' where id = 'e000000b-0000-0000-0000-000000000000';
insert into nfe_notas(id, empresa_id, chave, numero, emissao, tipo, emissao_propria, situacao, dest_nome, v_nf, xml) values
  ('ad100000-0000-0000-0000-000000000081', 'e000000a-0000-0000-0000-000000000000', '26261111111111111111550010000077011000000001', 77701, '2026-10-20', 'saida', true, 'autorizada', 'CLIENTE FINAL', 1500,
   '<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe><emit><enderEmit><cMun>2604106</cMun><xMun>Caruaru</xMun><UF>PE</UF></enderEmit></emit><dest><enderDest><cMun>2611606</cMun><xMun>Recife</xMun><UF>PE</UF></enderDest></dest><transp><modFrete>0</modFrete><transporta><CNPJ>22222222000122</CNPJ><xNome>TRANSP B</xNome></transporta><vol><pesoB>800.000</pesoB></vol></transp></infNFe></NFe></nfeProc>'),
  ('ad100000-0000-0000-0000-000000000082', 'e000000a-0000-0000-0000-000000000000', '26261111111111111111550010000077021000000002', 77702, '2026-10-21', 'saida', true, 'cancelada', 'CANCELADA', 10,
   '<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe><transp><modFrete>0</modFrete></transp></infNFe></NFe></nfeProc>');

-- sem autorização: a B não acha nada
select pg_temp.entrar('b0000000-0000-0000-0000-00000000000b');
select pg_temp.ok((select count(*) from log_mdfe_notas('e000000b-0000-0000-0000-000000000000', array[77701])) = 0, 'sem autorização não acha pelo número');
select pg_temp.ok((select count(*) from log_nfe_cliente('e000000b-0000-0000-0000-000000000000', '2026-10-01', '2026-10-31')) = 0, 'sem autorização a lista é vazia');
-- a B não pode se autorizar
do $$ begin
  begin insert into nfe_compartilhamento(empresa_origem, empresa_destino) values ('e000000a-0000-0000-0000-000000000000', 'e000000b-0000-0000-0000-000000000000');
    raise exception 'FALHOU: transportadora se autorizou';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- o admin da A autoriza
select pg_temp.entrar('a0000000-0000-0000-0000-00000000000a');
insert into nfe_compartilhamento(empresa_origem, empresa_destino) values ('e000000a-0000-0000-0000-000000000000', 'e000000b-0000-0000-0000-000000000000');
reset role;

select pg_temp.entrar('b0000000-0000-0000-0000-00000000000b');
select pg_temp.ok((select count(*) from nfe_compartilhamento) = 1, 'a B vê a autorização');
select pg_temp.ok((select (xmun, peso_kg, v_nf) = ('Recife', 800.000::numeric, 1500::numeric) from log_mdfe_notas('e000000b-0000-0000-0000-000000000000', array[77701])), 'acha pelo número com destino, peso e valor');
select pg_temp.ok((select count(*) from log_mdfe_notas('e000000b-0000-0000-0000-000000000000', array[77702])) = 0, 'nota cancelada do cliente fica fora');
select pg_temp.ok((select desta_empresa and transp_nome = 'TRANSP B' and origem = 'Empresa A' from log_nfe_cliente('e000000b-0000-0000-0000-000000000000', '2026-10-01', '2026-10-31') where numero = 77701), 'lista marca a nota que indica a B como transportadora');
select pg_temp.ok((select count(*) from nfe_notas where empresa_id = 'e000000a-0000-0000-0000-000000000000') = 0, 'a B continua sem ler nfe_notas da A direto');
do $$ begin
  begin perform * from log_nfe_cliente('e000000b-0000-0000-0000-000000000000', '2026-01-01', '2026-10-31'); raise exception 'FALHOU: período longo aceito';
  exception when raise_exception then if sqlerrm like 'FALHOU%' then raise; end if; end;
end $$;
reset role;

-- revoga
select pg_temp.entrar('a0000000-0000-0000-0000-00000000000a');
update nfe_compartilhamento set ativo = false;
reset role;
select pg_temp.entrar('b0000000-0000-0000-0000-00000000000b');
select pg_temp.ok((select count(*) from log_mdfe_notas('e000000b-0000-0000-0000-000000000000', array[77701])) = 0, 'revogada: não acha mais');
reset role;
delete from nfe_notas where id in ('ad100000-0000-0000-0000-000000000081', 'ad100000-0000-0000-0000-000000000082');

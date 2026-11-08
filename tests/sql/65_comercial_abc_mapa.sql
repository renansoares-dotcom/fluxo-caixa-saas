-- Curva ABC e mapa (SQL 129): municípios, município do cliente pela NF-e e pelo nome, parâmetros e visibilidade do representante.
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
create or replace function pg_temp.falha(p_sql text, p_msg text) returns void language plpgsql as $$
begin
  begin execute p_sql; exception when others then return; end;
  raise exception 'FALHOU (devia dar erro): %', p_msg;
end $$;
select pg_temp.ok((select count(*) > 5500 from geo_municipios), 'municípios carregados');
select pg_temp.ok((select nome = 'Caruaru' and uf = 'PE' from geo_municipios where codigo_ibge = 2604106), 'Caruaru');
select pg_temp.ok((select geo_km(lat, lng, (select lat from geo_municipios where codigo_ibge = 2611606), (select lng from geo_municipios where codigo_ibge = 2611606)) between 110 and 135
                     from geo_municipios where codigo_ibge = 2604106), 'Caruaru–Recife ~120 km');
select pg_temp.ok(_sem_acento('São João') = 'sao joao', 'sem acento');

insert into auth.users(id, email) values ('65000000-0000-0000-0000-0000000000a1', 'rep65@exemplo.com');
insert into membros(empresa_id, user_id, papel) values ('e000000a-0000-0000-0000-000000000000', '65000000-0000-0000-0000-0000000000a1', 'vendas');
insert into favorecidos(id, empresa_id, tipo, nome) values ('65000000-0000-0000-0000-0000000000e1', 'e000000a-0000-0000-0000-000000000000', 'REPRESENTANTES', 'REP 65') on conflict do nothing;
insert into comercial_vendedores(empresa_id, nome, representante_id, user_id) values ('e000000a-0000-0000-0000-000000000000', 'Rep 65', '65000000-0000-0000-0000-0000000000e1', '65000000-0000-0000-0000-0000000000a1');
insert into favorecidos(id, empresa_id, tipo, nome, documento, municipio, uf, representante_id) values
  ('65000000-0000-0000-0000-0000000000f1', 'e000000a-0000-0000-0000-000000000000', 'CLIENTES', 'CLIENTE XML 65', '65.000.000/0001-01', null, null, null),
  ('65000000-0000-0000-0000-0000000000f2', 'e000000a-0000-0000-0000-000000000000', 'CLIENTES', 'CLIENTE NOME 65', null, 'São Caetano', 'pe', '65000000-0000-0000-0000-0000000000e1'),
  ('65000000-0000-0000-0000-0000000000f3', 'e000000a-0000-0000-0000-000000000000', 'CLIENTES', 'CLIENTE SEM 65', null, 'Cidade Inventada', 'PE', null);
insert into nfe_notas(id, empresa_id, chave, numero, emissao, tipo, emissao_propria, situacao, dest_doc, xml) values
  ('65000000-0000-0000-0000-0000000000d1', 'e000000a-0000-0000-0000-000000000000', 'GEO65A', 96501, current_date - 40, 'saida', true, 'autorizada', '65000000000101',
   '<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe><dest><enderDest><cMun>2611606</cMun><xMun>Recife</xMun></enderDest></dest></infNFe></NFe></nfeProc>'),
  ('65000000-0000-0000-0000-0000000000d2', 'e000000a-0000-0000-0000-000000000000', 'GEO65B', 96502, current_date - 5, 'saida', true, 'autorizada', '65000000000101',
   '<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe><dest><enderDest><cMun>2604106</cMun><xMun>Caruaru</xMun></enderDest></dest></infNFe></NFe></nfeProc>');

select pg_temp.entrar('c0000000-0000-0000-0000-00000000000c');   -- leitura: interno, pode preencher (só o município)
select pg_temp.ok((select public.comercial_geo_preencher('e000000a-0000-0000-0000-000000000000') >= 2), 'preencheu');
reset role;
select pg_temp.ok((select cod_municipio = 2604106 from favorecidos where id = '65000000-0000-0000-0000-0000000000f1'), 'pela última nota');
select pg_temp.ok((select cod_municipio = 2613107 from favorecidos where id = '65000000-0000-0000-0000-0000000000f2'), 'pelo nome sem acento');
select pg_temp.ok((select cod_municipio is null from favorecidos where id = '65000000-0000-0000-0000-0000000000f3'), 'cidade desconhecida fica vazia');

-- o representante vê só a carteira dele
select pg_temp.entrar('65000000-0000-0000-0000-0000000000a1');
select pg_temp.ok((select count(*) = 1 and bool_and(lat is not null) from public.comercial_geo_clientes('e000000a-0000-0000-0000-000000000000') where id::text like '65000000%'), 'representante: só a carteira');
select pg_temp.falha($$insert into comercial_config(empresa_id) values ('e000000a-0000-0000-0000-000000000000')$$, 'representante não configura');
select pg_temp.entrar('a0000000-0000-0000-0000-00000000000a');
select pg_temp.ok((select count(*) = 3 from public.comercial_geo_clientes('e000000a-0000-0000-0000-000000000000') where id::text like '65000000%'), 'admin: todos');
select pg_temp.falha($$insert into comercial_config(empresa_id, abc_a_pct, abc_b_pct) values ('e000000a-0000-0000-0000-000000000000', 90, 85)$$, 'B maior que A');
insert into comercial_config(empresa_id, origem_cod_municipio) values ('e000000a-0000-0000-0000-000000000000', 2604106);
select pg_temp.ok((select nome = 'Caruaru' from public.comercial_origem('e000000a-0000-0000-0000-000000000000')), 'origem configurada');
select pg_temp.entrar('65000000-0000-0000-0000-0000000000a1');
select pg_temp.ok((select abc_a_pct = 80 and raio_km = 250 from comercial_config where empresa_id = 'e000000a-0000-0000-0000-000000000000'), 'representante lê os parâmetros');
select pg_temp.entrar('b0000000-0000-0000-0000-00000000000b');
select pg_temp.ok((select count(*) = 0 from public.comercial_geo_clientes('e000000a-0000-0000-0000-000000000000')), 'outra empresa');
select pg_temp.falha($$select public.comercial_geo_preencher('e000000a-0000-0000-0000-000000000000')$$, 'outra empresa não preenche');
reset role;
\o
select 'ok 65 comercial ABC e mapa';

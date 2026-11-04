-- Parâmetros do e-frete (SQL 082): 12 tipos de carga padrão por empresa; só o admin grava; leitura vê; outra empresa não vê;
-- colunas novas do transportador e do frete.
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

select pg_temp.ok((select count(*) from efrete_tipos_carga where empresa_id = 'e000000a-0000-0000-0000-000000000000') = 12, '12 tipos de carga padrão');
select pg_temp.ok((select codigo from efrete_tipos_carga where empresa_id = 'e000000a-0000-0000-0000-000000000000' and tipo_carga = 'geral') = 5, 'carga geral = 5');

select pg_temp.entrar('a0000000-0000-0000-0000-00000000000a');
insert into efrete_config (empresa_id, ambiente, pct_adiantamento, contratante_endereco) values ('e000000a-0000-0000-0000-000000000000', 'homologacao', 40, '{"rua":"RUA A"}');
update efrete_config set tipo_pagamento = 'DepositoAgendado' where empresa_id = 'e000000a-0000-0000-0000-000000000000';
do $$ begin
  begin update efrete_config set pct_adiantamento = 150; raise exception 'FALHOU: adiantamento > 100 aceito';
  exception when check_violation then null; end;
end $$;
update efrete_tipos_carga set codigo = 11 where empresa_id = 'e000000a-0000-0000-0000-000000000000' and tipo_carga = 'perigosa geral';
update log_transportadores set motoristas = '[]', endereco = '{}' where false;
reset role;

-- leitura: vê, não grava
select pg_temp.entrar('c0000000-0000-0000-0000-00000000000c');
select pg_temp.ok((select pct_adiantamento from efrete_config where empresa_id = 'e000000a-0000-0000-0000-000000000000') = 40, 'leitura vê os parâmetros');
update efrete_config set pct_adiantamento = 10;
reset role;
select pg_temp.ok((select pct_adiantamento from efrete_config where empresa_id = 'e000000a-0000-0000-0000-000000000000') = 40, 'leitura não altera');

-- outra empresa não vê
select pg_temp.entrar('b0000000-0000-0000-0000-00000000000b');
select pg_temp.ok((select count(*) from efrete_config where empresa_id = 'e000000a-0000-0000-0000-000000000000') = 0, 'outra empresa não vê');
select pg_temp.ok((select count(*) from efrete_tipos_carga where empresa_id = 'e000000a-0000-0000-0000-000000000000') = 0, 'outra empresa não vê os tipos');
reset role;
select pg_temp.ok((select count(*) from information_schema.columns where table_name = 'log_fretes' and column_name = 'ciot_dados') = 1, 'log_fretes.ciot_dados');
delete from efrete_config where empresa_id = 'e000000a-0000-0000-0000-000000000000';
